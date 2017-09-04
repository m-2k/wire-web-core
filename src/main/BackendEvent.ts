interface BackendEvent {
  conversation: string,
  time: string,
  data: {
    text: string,
    sender: string,
    recipient: string
  },
  from: string,
  type: 'conversation.otr-message-add'
}

export default BackendEvent;
