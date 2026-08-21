import { describe, expect, it } from "vitest";
import {
  catalogRefundAllocationIsValid,
  type CatalogCourse,
  type ExternalRegistrationCatalogCourse,
} from "@/infrastructure/supabase/catalog";

function allocationCourse(
  input: Pick<
    CatalogCourse,
    | "delivery_type"
    | "price_twd"
    | "recorded_refund_allocation_twd"
    | "live_refund_allocations"
  >,
) {
  return input as CatalogCourse;
}

describe("published refund allocation disclosure", () => {
  it("keeps an approved external form visible without commerce fields", () => {
    const course = {
      registration_mode: "google_form",
      external_registration_url:
        "https://docs.google.com/forms/d/e/Approved_Form_123/viewform",
      price_twd: null,
      recorded_refund_allocation_twd: null,
      accreditation_status: null,
      accreditation_points: null,
      legal_document_id: null,
      legal_document_sha256: null,
    } as ExternalRegistrationCatalogCourse;
    expect(catalogRefundAllocationIsValid(course)).toBe(true);
  });

  it("accepts a hybrid allocation only when every component sums to price", () => {
    expect(
      catalogRefundAllocationIsValid(
        allocationCourse({
          delivery_type: "hybrid",
          price_twd: 1_000,
          recorded_refund_allocation_twd: 600,
          live_refund_allocations: [
            {
              componentId: "live-one",
              title: "線上同步課程",
              amountTwd: 400,
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("fails closed when the public allocation does not equal total price", () => {
    expect(
      catalogRefundAllocationIsValid(
        allocationCourse({
          delivery_type: "hybrid",
          price_twd: 1_000,
          recorded_refund_allocation_twd: 600,
          live_refund_allocations: [
            {
              componentId: "live-one",
              title: "線上同步課程",
              amountTwd: 399,
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("does not allow hidden live allocation on a recorded-only course", () => {
    expect(
      catalogRefundAllocationIsValid(
        allocationCourse({
          delivery_type: "recorded",
          price_twd: 500,
          recorded_refund_allocation_twd: 500,
          live_refund_allocations: [
            {
              componentId: "unexpected",
              title: "未揭露直播",
              amountTwd: 0,
            },
          ],
        }),
      ),
    ).toBe(false);
  });
});
