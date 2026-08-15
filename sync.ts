const denoJson = JSON.parse(await Deno.readTextFile("deno.json"));
const packageJson = JSON.parse(await Deno.readTextFile("package.json"));

denoJson.version = packageJson.version;

await Deno.writeTextFile("deno.json", JSON.stringify(denoJson, null, 4) + "\n");