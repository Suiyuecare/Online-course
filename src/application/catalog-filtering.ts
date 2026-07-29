import type { CatalogCourse } from "@/infrastructure/supabase/catalog";

export const catalogDeliveryFilters = [
  "all",
  "recorded",
  "live",
  "hybrid",
] as const;

export const catalogAccreditationFilters = [
  "all",
  "approved",
  "applying",
] as const;

export type CatalogDeliveryFilter = (typeof catalogDeliveryFilters)[number];
export type CatalogAccreditationFilter =
  (typeof catalogAccreditationFilters)[number];

export type CatalogFilters = {
  query: string;
  delivery: CatalogDeliveryFilter;
  accreditation: CatalogAccreditationFilter;
};

export type CatalogSearchParams = Record<string, string | string[] | undefined>;

const maximumQueryLength = 100;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isDeliveryFilter(
  value: string | undefined,
): value is CatalogDeliveryFilter {
  return catalogDeliveryFilters.some((candidate) => candidate === value);
}

function isAccreditationFilter(
  value: string | undefined,
): value is CatalogAccreditationFilter {
  return catalogAccreditationFilters.some((candidate) => candidate === value);
}

function normalizeSearchValue(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-Hant-TW");
}

export function parseCatalogFilters(
  searchParams: CatalogSearchParams,
): CatalogFilters {
  const rawQuery = firstValue(searchParams.q)?.trim() ?? "";
  const delivery = firstValue(searchParams.delivery);
  const accreditation = firstValue(searchParams.accreditation);

  return {
    query: rawQuery.slice(0, maximumQueryLength),
    delivery: isDeliveryFilter(delivery) ? delivery : "all",
    accreditation: isAccreditationFilter(accreditation) ? accreditation : "all",
  };
}

export function filterCatalogCourses(
  courses: CatalogCourse[],
  filters: CatalogFilters,
) {
  const normalizedQuery = normalizeSearchValue(filters.query);

  return courses.filter((course) => {
    if (
      filters.delivery !== "all" &&
      course.delivery_type !== filters.delivery
    ) {
      return false;
    }
    if (
      filters.accreditation !== "all" &&
      course.accreditation_status !== filters.accreditation
    ) {
      return false;
    }
    if (!normalizedQuery) return true;

    const searchableText = [
      course.title,
      course.summary,
      course.description,
      ...course.learning_objectives,
      ...course.instructors.flatMap((instructor) => [
        instructor.name,
        instructor.credentials,
      ]),
    ].join(" ");

    return normalizeSearchValue(searchableText).includes(normalizedQuery);
  });
}

export function catalogFiltersAreActive(filters: CatalogFilters) {
  return (
    Boolean(filters.query) ||
    filters.delivery !== "all" ||
    filters.accreditation !== "all"
  );
}

export function catalogFilterQuery(filters: CatalogFilters, category?: string) {
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  if (filters.delivery !== "all") params.set("delivery", filters.delivery);
  if (filters.accreditation !== "all") {
    params.set("accreditation", filters.accreditation);
  }
  if (category) params.set("category", category);
  return params.toString();
}
