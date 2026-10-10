import type { SenderClient } from "./unipile";

/** A stand-in for the Unipile client in demo mode. It sends nothing anywhere and remembers nothing. */
export function demoSender(): SenderClient {
  let n = 0;
  return {
    async getProfile(_account, identifier) {
      return { providerId: `demo_provider_${identifier}`, publicIdentifier: identifier, networkDistance: "SECOND_DEGREE" };
    },
    async sendInvitation() {
      n += 1;
      return { invitationId: `demo_invitation_${n}` };
    },
    async startChat() {
      n += 1;
      return { chatId: `demo_chat_${n}`, messageId: `demo_message_${n}` };
    },
    async sendMessage() {
      n += 1;
      return { messageId: `demo_message_${n}` };
    },
    async listMessages() {
      return [];
    },
  };
}
