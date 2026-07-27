export type ZoomMeetingSafetyEvidence = {
  id: number | string;
  uuid: string;
  hostId: string;
  type?: number;
  topic?: string;
  startTime?: string;
  durationMinutes?: number;
  settings?: {
    waiting_room?: boolean;
    join_before_host?: boolean;
    auto_recording?: string;
    meeting_authentication?: boolean;
    approval_type?: number;
    registration_type?: number;
  };
};

export type ZoomMeetingBusinessSpec = {
  meetingType: 2;
  hostId: string;
  topic: string;
  startsAt: string;
  durationMinutes: number;
};

export type ZoomHostSafetyEvidence = {
  in_meeting?: {
    allow_participants_to_rename?: boolean;
    who_can_share_screen?: string;
    allow_removed_participants_to_rejoin?: boolean;
  };
  recording?: {
    cloud_recording?: boolean;
  };
};

export type ZoomSafetyAttestation = {
  accountlessJoinEnabled: true;
  waitingRoom: true;
  participantRenameDisabled: true;
  participantShareDisabled: true;
  cloudRecordingDisabled: true;
  removedParticipantRejoinDisabled: true;
  verifiedAt: string;
};

function assertSafeProviderSettings(
  meeting: ZoomMeetingSafetyEvidence,
  hostSettings: ZoomHostSafetyEvidence,
) {
  if (
    meeting.settings?.waiting_room !== true ||
    meeting.settings?.join_before_host !== false ||
    meeting.settings?.auto_recording !== "none" ||
    meeting.settings?.meeting_authentication !== false ||
    meeting.settings?.approval_type !== 0 ||
    meeting.settings?.registration_type !== 1 ||
    hostSettings.in_meeting?.allow_participants_to_rename !== false ||
    hostSettings.in_meeting?.who_can_share_screen !== "host" ||
    hostSettings.in_meeting?.allow_removed_participants_to_rejoin !== false ||
    hostSettings.recording?.cloud_recording !== false
  ) {
    throw new Error("ZOOM_HOST_CONFIGURATION_UNSAFE");
  }
}

function assertBusinessSpec(
  meeting: ZoomMeetingSafetyEvidence,
  expected: ZoomMeetingBusinessSpec,
  errorCode: string,
) {
  const expectedStart = Date.parse(expected.startsAt);
  const actualStart = Date.parse(meeting.startTime ?? "");
  if (
    meeting.type !== expected.meetingType ||
    meeting.hostId !== expected.hostId ||
    meeting.topic !== expected.topic ||
    !Number.isFinite(expectedStart) ||
    !Number.isFinite(actualStart) ||
    Math.abs(expectedStart - actualStart) > 60_000 ||
    meeting.durationMinutes !== expected.durationMinutes
  ) {
    throw new Error(errorCode);
  }
}

export function attestZoomMeetingSafety(input: {
  created: ZoomMeetingSafetyEvidence;
  readback: ZoomMeetingSafetyEvidence;
  hostSettings: ZoomHostSafetyEvidence;
  expected: ZoomMeetingBusinessSpec;
  verifiedAt?: string;
}): ZoomSafetyAttestation {
  if (
    String(input.created.id) !== String(input.readback.id) ||
    input.created.uuid !== input.readback.uuid ||
    input.created.hostId !== input.readback.hostId
  ) {
    throw new Error("ZOOM_HOST_CONFIGURATION_UNSAFE");
  }
  assertBusinessSpec(
    input.readback,
    input.expected,
    "ZOOM_MEETING_SPEC_MISMATCH",
  );
  assertSafeProviderSettings(input.readback, input.hostSettings);
  const verifiedAt = input.verifiedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(verifiedAt))) {
    throw new Error("ZOOM_SAFETY_ATTESTATION_TIME_INVALID");
  }
  return {
    accountlessJoinEnabled: true,
    waitingRoom: true,
    participantRenameDisabled: true,
    participantShareDisabled: true,
    cloudRecordingDisabled: true,
    removedParticipantRejoinDisabled: true,
    verifiedAt,
  };
}

export function attestExistingZoomMeetingSafety(input: {
  meeting: ZoomMeetingSafetyEvidence & { password?: string };
  hostSettings: ZoomHostSafetyEvidence;
  expected: Omit<ZoomMeetingBusinessSpec, "meetingType"> & {
    meetingNumber: string;
  };
  verifiedAt?: string;
}): ZoomSafetyAttestation {
  if (
    String(input.meeting.id) !== input.expected.meetingNumber ||
    !input.meeting.password ||
    input.meeting.password.length > 32
  ) {
    throw new Error("ZOOM_RECONCILIATION_MEETING_MISMATCH");
  }
  assertBusinessSpec(
    input.meeting,
    { meetingType: 2, ...input.expected },
    "ZOOM_RECONCILIATION_MEETING_MISMATCH",
  );
  assertSafeProviderSettings(input.meeting, input.hostSettings);
  return attestZoomMeetingSafety({
    created: input.meeting,
    readback: input.meeting,
    hostSettings: input.hostSettings,
    expected: { meetingType: 2, ...input.expected },
    verifiedAt: input.verifiedAt,
  });
}
