"use client";

import type { Participant } from "@zoom/meetingsdk/embedded";

const ZOOM_MEETING_SDK_VERSION = "6.2.0";
const ZOOM_ASSET_ROOT = `https://source.zoom.us/${ZOOM_MEETING_SDK_VERSION}/lib`;

export type ZoomJoinMaterial = {
  signature: string;
  meetingNumber: string;
  passcode: string;
  displayName: string;
  syntheticEmail?: string;
  customerKey?: string;
  registrantToken?: string;
  zak?: string;
};

export type ZoomMeetingController = {
  view: "component" | "client";
  cameraOn(): Promise<boolean>;
  leave(): Promise<void>;
};

export function isMobileZoomBrowser(input: {
  userAgent: string;
  coarsePointer: boolean;
  narrowViewport: boolean;
}): boolean {
  return (
    input.coarsePointer ||
    input.narrowViewport ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(input.userAgent)
  );
}

function assertJoinMaterial(material: ZoomJoinMaterial) {
  if (material.registrantToken !== undefined) {
    if (!material.registrantToken) {
      throw new Error("ZOOM_REGISTRANT_TOKEN_MISSING");
    }
    if (
      !material.customerKey ||
      !/^[A-Za-z0-9_-]{1,36}$/.test(material.customerKey)
    ) {
      throw new Error("ZOOM_CUSTOMER_KEY_INVALID");
    }
    if (
      !material.syntheticEmail ||
      !/^[^@\s]+@zoom-id\.suiyuecare\.com$/i.test(material.syntheticEmail)
    ) {
      throw new Error("ZOOM_SYNTHETIC_EMAIL_INVALID");
    }
  }
}

function mobileBrowser() {
  return isMobileZoomBrowser({
    userAgent: navigator.userAgent,
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
    narrowViewport: window.matchMedia("(max-width: 767px)").matches,
  });
}

async function joinComponentView(
  root: HTMLElement,
  material: ZoomJoinMaterial,
): Promise<ZoomMeetingController> {
  const { default: ZoomMtgEmbedded } = await import(
    "@zoom/meetingsdk/embedded"
  );
  const client = ZoomMtgEmbedded.createClient();
  const compatibility = client.checkSystemRequirements();
  if (!compatibility.audio || !compatibility.video) {
    throw new Error("ZOOM_BROWSER_MEDIA_UNSUPPORTED");
  }
  await client.init({
    zoomAppRoot: root,
    language: "zh-TW",
    assetPath: `${ZOOM_ASSET_ROOT}/av`,
    patchJsMedia: true,
    leaveOnPageUnload: true,
    customize: {
      video: {
        isResizable: true,
        viewSizes: { default: { width: 960, height: 540 } },
      },
    },
  });
  await client.join({
    signature: material.signature,
    meetingNumber: material.meetingNumber,
    password: material.passcode,
    tk: material.registrantToken,
    zak: material.zak,
    userName: material.displayName,
    userEmail: material.syntheticEmail,
    customerKey: material.customerKey,
  });
  return {
    view: "component",
    async cameraOn() {
      const participant: Participant | null = client.getCurrentUser();
      return Boolean(participant?.video ?? participant?.bVideoOn);
    },
    async leave() {
      await client.leaveMeeting();
      ZoomMtgEmbedded.destroyClient();
    },
  };
}

async function joinClientView(
  material: ZoomJoinMaterial,
): Promise<ZoomMeetingController> {
  const { ZoomMtg } = await import("@zoom/meetingsdk");
  ZoomMtg.setZoomJSLib(ZOOM_ASSET_ROOT, "/av");
  ZoomMtg.preLoadWasm();
  ZoomMtg.prepareWebSDK();
  ZoomMtg.checkFeatureRequirements();
  if (
    typeof WebAssembly === "undefined" ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    throw new Error("ZOOM_BROWSER_MEDIA_UNSUPPORTED");
  }
  await new Promise<void>((resolve, reject) => {
    ZoomMtg.init({
      leaveUrl: window.location.href,
      patchJsMedia: true,
      disableInvite: true,
      disableCallOut: true,
      disableRecord: true,
      screenShare: false,
      showMeetingHeader: false,
      success: () => resolve(),
      error: () => reject(new Error("ZOOM_CLIENT_INIT_FAILED")),
    });
  });
  await new Promise<void>((resolve, reject) => {
    ZoomMtg.join({
      signature: material.signature,
      meetingNumber: material.meetingNumber,
      passWord: material.passcode,
      tk: material.registrantToken,
      zak: material.zak,
      userName: material.displayName,
      userEmail: material.syntheticEmail,
      customerKey: material.customerKey,
      success: () => resolve(),
      error: () => reject(new Error("ZOOM_CLIENT_JOIN_FAILED")),
    });
  });
  document.getElementById("zmmtg-root")?.style.setProperty("display", "block");
  return {
    view: "client",
    cameraOn() {
      return new Promise<boolean>((resolve) => {
        ZoomMtg.getCurrentUser({
          success: (response: unknown) => {
            const result = response as {
              result?: {
                currentUser?: { video?: boolean; bVideoOn?: boolean };
                video?: boolean;
                bVideoOn?: boolean;
              };
            };
            const current = result.result?.currentUser ?? result.result;
            resolve(Boolean(current?.video ?? current?.bVideoOn));
          },
          error: () => resolve(false),
        });
      });
    },
    leave() {
      return new Promise<void>((resolve, reject) => {
        ZoomMtg.leaveMeeting({
          confirm: false,
          success: () => {
            document
              .getElementById("zmmtg-root")
              ?.style.setProperty("display", "none");
            resolve();
          },
          error: () => reject(new Error("ZOOM_CLIENT_LEAVE_FAILED")),
        });
      });
    },
  };
}

export async function joinZoomMeeting(
  root: HTMLElement,
  material: ZoomJoinMaterial,
): Promise<ZoomMeetingController> {
  assertJoinMaterial(material);
  return mobileBrowser()
    ? joinClientView(material)
    : joinComponentView(root, material);
}
