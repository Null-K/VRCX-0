const ActivityType = Object.freeze({
    Playing: 0,
    Listening: 2,
    Watching: 3,
    Competing: 5
} as const);

const StatusDisplayType = Object.freeze({
    Name: 0,
    State: 1,
    Details: 2
} as const);

type ActivityTypeValue = (typeof ActivityType)[keyof typeof ActivityType];
type StatusDisplayTypeValue =
    (typeof StatusDisplayType)[keyof typeof StatusDisplayType];

export { ActivityType, StatusDisplayType };
export type { ActivityTypeValue, StatusDisplayTypeValue };
