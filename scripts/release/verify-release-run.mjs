import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export function verifiedRun(run, jobs, artifact, runId) {
  if (
    run.conclusion !== 'success' ||
    run.head_branch !== 'main' ||
    run.repository.full_name !== 'bYiyLi/Avru' ||
    run.path !== '.github/workflows/npm-dev-prepare.yml' ||
    !/^[a-f0-9]{40}$/.test(run.head_sha) ||
    artifact.expired ||
    String(artifact.workflow_run.id) !== runId ||
    artifact.workflow_run.head_sha !== run.head_sha
  )
    throw new Error('Candidate source or artifact identity mismatch');
  for (const os of ['macos-latest', 'windows-latest'])
    if (
      !jobs.some(
        (job) =>
          job.name === `validate (${os})` && job.conclusion === 'success',
      )
    )
      throw new Error('Exact candidate platform validation missing');
  return run.head_sha;
}
async function main() {
  const runId = process.env.AVRU_CANDIDATE_RUN;
  const artifactId = process.env.AVRU_CANDIDATE_ARTIFACT;
  if (!/^\d+$/.test(runId ?? '') || !/^\d+$/.test(artifactId ?? ''))
    throw new Error('Invalid candidate selection');
  const get = (path) =>
    JSON.parse(
      execFileSync('gh', ['api', `repos/bYiyLi/Avru/${path}`], {
        encoding: 'utf8',
      }),
    );
  const run = get(`actions/runs/${runId}`);
  const { jobs } = get(`actions/runs/${runId}/jobs`);
  const artifact = get(`actions/artifacts/${artifactId}`);
  verifiedRun(run, jobs, artifact, runId);
  if (!process.env.GITHUB_OUTPUT) throw new Error('GitHub output unavailable');
  await appendFile(process.env.GITHUB_OUTPUT, `source_sha=${run.head_sha}\n`);
  console.log(
    `Both platforms accepted source ${run.head_sha}; candidate selection verified.`,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
