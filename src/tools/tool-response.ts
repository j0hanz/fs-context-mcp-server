export function buildToolResponse<T>(
  text: string,
  structuredContent: T
): {
  content: { type: 'text'; text: string }[];
  structuredContent: T;
} {
  return {
    content: [{ type: 'text', text }],
    structuredContent,
  };
}

export type ToolResponse<T> = ReturnType<typeof buildToolResponse<T>>;
