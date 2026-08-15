const denoJsonText = await Deno.readTextFile("deno.json");
const packageJsonText = await Deno.readTextFile("package.json");

const denoJson = JSON.parse(denoJsonText);
const packageJson = JSON.parse(packageJsonText);

denoJson.version = packageJson.version;

await Promise.all(
  Object.keys(denoJson.imports).map(async (key) => {
    if (key.startsWith("@collidor/")) {
      const pkgName = key.replace("@collidor/", "");
      const pkgPackageJsonText = await Deno.readTextFile(
        `../${pkgName}/package.json`,
      );
      const pkgPackageJson = JSON.parse(pkgPackageJsonText);
      denoJson.imports[key] = `jsr:${key}@^${pkgPackageJson.version}`;
    }
  }),
);

await Deno.writeTextFile("deno.json", JSON.stringify(denoJson, null, 4));
