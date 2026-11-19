import { describe, expect, it } from "vitest";
import {
  FACE_MODEL_FILES,
  faceModelsAvailable,
  faceModelsDir,
  resolveFaceModelFile,
} from "./face-models";

describe("the face models on this machine", () => {
  it("are in the installed package", () => {
    const dir = faceModelsDir();
    expect(dir).not.toBeNull();
    expect(faceModelsAvailable()).toBe(true);
    for (const file of FACE_MODEL_FILES) {
      expect(resolveFaceModelFile(file)).not.toBeNull();
    }
  });

  it("refuses a file that is not on the list", () => {
    expect(resolveFaceModelFile("../package.json")).toBeNull();
    expect(resolveFaceModelFile("ssd_mobilenetv1_model.bin")).toBeNull();
  });
});
