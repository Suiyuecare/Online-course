import { z } from "zod";

export const zoomMeetingReceiptSchema = z.object({
  meetingNumber: z.string().min(1),
  meetingUuid: z.string().min(1),
  meetingType: z.literal(2),
  topic: z.string().min(1).max(200),
  startsAt: z.iso.datetime({ offset: true }),
  durationMinutes: z.number().int().positive(),
  encryptedPasscode: z.object({
    version: z.literal(1),
    iv: z.string().min(1),
    ciphertext: z.string().min(1),
    tag: z.string().min(1),
  }),
  providerHostId: z.string().min(1),
  safety: z.object({
    accountlessJoinEnabled: z.literal(true),
    waitingRoom: z.literal(true),
    participantRenameDisabled: z.literal(true),
    participantShareDisabled: z.literal(true),
    cloudRecordingDisabled: z.literal(true),
    removedParticipantRejoinDisabled: z.literal(true),
    verifiedAt: z.iso.datetime({ offset: true }),
  }),
});

export type ZoomMeetingReceipt = z.infer<typeof zoomMeetingReceiptSchema>;
