/**
 * LinterFlow — headless pipeline runner (phase 2 of the experiment)
 * -----------------------------------------------------------------
 * Runs the mitigation loop over a directory without going through HTTP.
 *
 *   npm run pipeline -- corpus-run
 *
 * Why not the API: POST /api/orchestrator/start fires orchestrateFolder
 * WITHOUT awaiting it and returns 202 immediately, so a long batch gives no
 * progress and no exit code. It also drags in auth and billing, which have
 * nothing to do with the experiment. This boots the same Nest providers with
 * no HTTP layer and awaits the run, so the logs and the exit status mean
 * something.
 *
 * The pipeline OVERWRITES what it refactors and deletes the .bak on
 * convergence. Point this at a COPY (cp -r corpus/ corpus-run/), never at
 * corpus/ itself, and never twice at the same folder — a second pass would
 * snapshot already-refactored code as the "pre" state.
 *
 * Interrupting is safe: the Reporter checkpoints after every file and the run
 * resumes from it, so re-running the same command picks up where it stopped.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { ProducerService } from '../src/producer/producer.service';

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error(
      'Usage: npm run pipeline -- <targetDirectory>\n' +
        'Refusing to guess a directory: this command rewrites every .ts file it finds.',
    );
    process.exit(1);
  }

  const targetDirectory = path.resolve(process.cwd(), target);
  if (!fs.existsSync(targetDirectory) || !fs.statSync(targetDirectory).isDirectory()) {
    console.error(`❌ Not a directory: ${targetDirectory}`);
    process.exit(1);
  }

  // Guard against the one mistake that destroys a week of work.
  if (path.basename(targetDirectory) === 'corpus') {
    console.error(
      `❌ Refusing to run against corpus/ — the pipeline overwrites what it refactors.\n` +
        `   Run it over a copy instead:  cp -r corpus/ corpus-run/`,
    );
    process.exit(1);
  }

  const started = Date.now();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const logger = new Logger('run-pipeline');

  logger.log(`Target: ${targetDirectory}`);
  logger.log(`Model:  ${process.env.GEMINI_MODEL ?? 'gemini-3.6-flash (default)'}`);
  // No sampling parameters are logged because none are sent: Gemini 3.6 Flash
  // ignores temperature/top_p/top_k. See ProducerService.executeGeminiRefactor.

  try {
    await app.get(ProducerService).orchestrateFolder(targetDirectory);
  } finally {
    await app.close();
  }

  const minutes = ((Date.now() - started) / 60000).toFixed(1);
  logger.log(`Finished in ${minutes} min.`);
}

main().catch((error) => {
  console.error(`\n❌ Fatal: ${error.message}`);
  process.exit(1);
});
