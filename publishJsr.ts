const jsrToken = Deno.env.get("JSR_TOKEN");
const args = ["publish"];
if (jsrToken) {
  args.push("--token", jsrToken);
}

const command = new Deno.Command("deno", {
  args,
  env: Deno.env.toObject(),
  cwd: import.meta.dirname!,
  stdin: "inherit",
  stdout: "inherit",
});

const child = command.spawn();
await child.status.then((status) => {
  if (!status.success) {
    throw new Error(`Command failed with exit code ${status.code}`);
  }
});
