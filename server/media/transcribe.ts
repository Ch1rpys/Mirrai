import { listUntranscribedMedia, setMediaTranscript, updateRecordMeta } from "../db";
import { sttEngine, sttIsLocal, transcribeAudio } from "../_core/stt";
import { mediaAbsPath, mediaFileName } from "../importers/media";

/**
 * Turning the imported voice notes into words.
 *
 * It runs in the background — a persona may have hundreds of recordings
 * — and only on a local engine. The other person's real voice is not
 * sent to a cloud service to build a persona; `purpose: "import"`
 * enforces that inside the transcriber, and the route says so before
 * it starts.
 *
 * The result goes to two places: the media row, and the record's
 * `meta.transcript`. The second is what the readers of content (facts,
 * people, likes, search) use through `recordText`.
 */

export interface TranscriptionRun {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  startedAt: string | null;
  lastError: string | null;
}

const runs = new Map<number, TranscriptionRun>();

function idle(): TranscriptionRun {
  return { running: false, total: 0, done: 0, failed: 0, startedAt: null, lastError: null };
}

export function transcriptionStatus(personaId: number): {
  run: TranscriptionRun;
  engine: ReturnType<typeof sttEngine>;
  local: boolean;
} {
  return {
    run: runs.get(personaId) ?? idle(),
    engine: sttEngine(),
    local: sttIsLocal(),
  };
}

export async function startMediaTranscription(params: {
  personaId: number;
  userId: number;
}): Promise<{ started: boolean; reason?: "no-local-engine" | "running"; total?: number }> {
  if (!sttIsLocal()) return { started: false, reason: "no-local-engine" };
  if (runs.get(params.personaId)?.running) return { started: false, reason: "running" };

  const rows = await listUntranscribedMedia(params.personaId, params.userId);
  const run: TranscriptionRun = {
    running: true,
    total: rows.length,
    done: 0,
    failed: 0,
    startedAt: new Date().toISOString(),
    lastError: null,
  };
  runs.set(params.personaId, run);

  void (async () => {
    for (const row of rows) {
      try {
        const result = await transcribeAudio({
          filePath: mediaAbsPath(row.fileKey),
          fileName: mediaFileName(row.fileKey),
          purpose: "import",
        });
        if (!result) {
          run.failed += 1;
          continue;
        }
        await setMediaTranscript(row.id, params.userId, result.text, result.engine);
        if (row.recordId != null) {
          await updateRecordMeta(row.recordId, params.userId, { transcript: result.text });
        }
        run.done += 1;
      } catch (error) {
        run.failed += 1;
        run.lastError = (error as Error).message;
      }
    }
  })()
    .catch((error) => {
      run.lastError = (error as Error).message;
    })
    .finally(() => {
      run.running = false;
    });

  return { started: true, total: rows.length };
}
