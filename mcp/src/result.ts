export const errorResult = (message: string) => ({
  content: [{ type: 'text' as const, text: `Error: ${message}` }],
  isError: true,
});
