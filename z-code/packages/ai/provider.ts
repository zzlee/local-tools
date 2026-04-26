import { GenerateContentOptions, GenerateContentResponse } from "./types.js";

export abstract class AIProvider {
  abstract generateContent(options: GenerateContentOptions): Promise<GenerateContentResponse>;
}
