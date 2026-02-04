import { createProgram } from "./cli/program";

async function main() {
  const program = createProgram();
  await program.parseAsync(process.argv);
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});

