export default {
  name: "ping",
  description: "Replies with pong",
  execute: async ({ sock, from }) => {
    await sock.sendMessage(from, { text: "pong 🏓" });
  },
};
