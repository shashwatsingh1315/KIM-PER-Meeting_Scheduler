const weekdayOptions = [
  ["Monday", "1"],
  ["Tuesday", "2"],
  ["Wednesday", "3"],
  ["Thursday", "4"],
  ["Friday", "5"],
  ["Saturday", "6"],
  ["Sunday", "7"],
].map(([text, value]) => ({ text: { type: "plain_text", text }, value }));

export function createMeetingModal(metadata: {
  channelId: string;
  userId: string;
  teamId: string;
}) {
  return {
    type: "modal",
    callback_id: "create_meeting_submission",
    private_metadata: JSON.stringify(metadata),
    title: { type: "plain_text", text: "Meeting Scheduler" },
    submit: { type: "plain_text", text: "Create" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "meeting_name",
        label: { type: "plain_text", text: "Meeting name" },
        element: {
          type: "plain_text_input",
          action_id: "value",
          placeholder: { type: "plain_text", text: "MES Daily Review" },
          max_length: 120,
        },
      },
      {
        type: "input",
        block_id: "weekdays",
        label: { type: "plain_text", text: "Meeting days" },
        element: {
          type: "multi_static_select",
          action_id: "value",
          options: weekdayOptions,
          initial_options: weekdayOptions.slice(0, 5),
        },
      },
      {
        type: "input",
        block_id: "start_time",
        label: { type: "plain_text", text: "Start time" },
        element: {
          type: "timepicker",
          action_id: "value",
          initial_time: "10:00",
          timezone: "Asia/Kolkata",
        },
      },
      {
        type: "input",
        block_id: "duration",
        label: { type: "plain_text", text: "Duration" },
        element: {
          type: "static_select",
          action_id: "value",
          initial_option: { text: { type: "plain_text", text: "30 minutes" }, value: "30" },
          options: [15, 30, 45, 60, 90].map((minutes) => ({
            text: { type: "plain_text", text: `${minutes} minutes` },
            value: String(minutes),
          })),
        },
      },
      {
        type: "input",
        block_id: "reminder",
        label: { type: "plain_text", text: "Reminder" },
        element: {
          type: "static_select",
          action_id: "value",
          initial_option: { text: { type: "plain_text", text: "10 minutes before" }, value: "10" },
          options: [0, 5, 10, 15, 30].map((minutes) => ({
            text: { type: "plain_text", text: minutes === 0 ? "At start time" : `${minutes} minutes before` },
            value: String(minutes),
          })),
        },
      },
      {
        type: "input",
        block_id: "huddle_url",
        optional: true,
        label: { type: "plain_text", text: "Reusable Huddle link" },
        element: {
          type: "url_text_input",
          action_id: "value",
          placeholder: { type: "plain_text", text: "Paste the channel Huddle link" },
        },
      },
      {
        type: "input",
        block_id: "agenda",
        optional: true,
        label: { type: "plain_text", text: "Agenda template" },
        element: {
          type: "plain_text_input",
          action_id: "value",
          multiline: true,
          initial_value: "Previous actions\nMetrics\nBlockers\nDecisions required\nNew actions",
        },
      },
    ],
  };
}
