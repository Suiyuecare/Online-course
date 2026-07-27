import { describe, expect, it } from "vitest";
import { attestZoomMeetingSafety } from "@/domain/zoom-safety";

function safeEvidence() {
  return {
    created: {
      id: 123456789,
      uuid: "meeting-uuid",
      hostId: "host-id",
      settings: {
        waiting_room: true,
        join_before_host: false,
        auto_recording: "none",
        meeting_authentication: false,
        approval_type: 0,
        registration_type: 1,
      },
    },
    readback: {
      id: 123456789,
      uuid: "meeting-uuid",
      hostId: "host-id",
      type: 2,
      topic: "照顧課程",
      startTime: "2026-08-01T01:00:00.000Z",
      durationMinutes: 60,
      settings: {
        waiting_room: true,
        join_before_host: false,
        auto_recording: "none",
        meeting_authentication: false,
        approval_type: 0,
        registration_type: 1,
      },
    },
    hostSettings: {
      in_meeting: {
        allow_participants_to_rename: false,
        who_can_share_screen: "host",
        allow_removed_participants_to_rejoin: false,
      },
      recording: { cloud_recording: false },
    },
    expected: {
      meetingType: 2 as const,
      hostId: "host-id",
      topic: "照顧課程",
      startsAt: "2026-08-01T01:00:00.000Z",
      durationMinutes: 60,
    },
    verifiedAt: "2026-07-24T12:00:00.000Z",
  };
}

describe("Zoom meeting safety attestation", () => {
  it("attests only matching create/readback and locked host settings", () => {
    expect(attestZoomMeetingSafety(safeEvidence())).toMatchObject({
      waitingRoom: true,
      participantRenameDisabled: true,
      participantShareDisabled: true,
      cloudRecordingDisabled: true,
      removedParticipantRejoinDisabled: true,
    });
  });

  it("fails closed when a provider field is unknown", () => {
    const evidence: Parameters<typeof attestZoomMeetingSafety>[0] =
      safeEvidence();
    delete evidence.hostSettings.in_meeting!
      .allow_removed_participants_to_rejoin;
    expect(() => attestZoomMeetingSafety(evidence)).toThrow(
      "ZOOM_HOST_CONFIGURATION_UNSAFE",
    );
  });

  it("rejects meetings that require a Zoom account", () => {
    const evidence: Parameters<typeof attestZoomMeetingSafety>[0] =
      safeEvidence();
    evidence.readback.settings!.meeting_authentication = true;
    expect(() => attestZoomMeetingSafety(evidence)).toThrow(
      "ZOOM_HOST_CONFIGURATION_UNSAFE",
    );
  });

  it("rejects a readback for a different provider meeting", () => {
    const evidence: Parameters<typeof attestZoomMeetingSafety>[0] =
      safeEvidence();
    evidence.readback.uuid = "different-meeting";
    expect(() => attestZoomMeetingSafety(evidence)).toThrow(
      "ZOOM_HOST_CONFIGURATION_UNSAFE",
    );
  });

  it("rejects a meeting whose provider readback differs from the business spec", () => {
    const evidence: Parameters<typeof attestZoomMeetingSafety>[0] =
      safeEvidence();
    evidence.readback.topic = "其他課程";
    expect(() => attestZoomMeetingSafety(evidence)).toThrow(
      "ZOOM_MEETING_SPEC_MISMATCH",
    );

    evidence.readback.topic = evidence.expected.topic;
    evidence.readback.type = 1;
    expect(() => attestZoomMeetingSafety(evidence)).toThrow(
      "ZOOM_MEETING_SPEC_MISMATCH",
    );
  });
});
