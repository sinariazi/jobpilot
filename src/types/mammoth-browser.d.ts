declare module "mammoth/mammoth.browser" {
  type ExtractedText = { value: string; messages: Array<{ type: string; message: string }> };
  const mammoth: {
    extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<ExtractedText>;
  };
  export = mammoth;
}
