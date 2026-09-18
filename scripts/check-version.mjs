import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const packageLock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
const version = packageJson.version;

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`package.jsonのバージョンがSemVer形式ではありません: ${version}`);
}

const lockVersions = [packageLock.version, packageLock.packages?.[""]?.version];
for (const lockVersion of lockVersions) {
  if (lockVersion !== version) {
    throw new Error(`package.json (${version}) と package-lock.json (${lockVersion}) のバージョンが一致しません。`);
  }
}

const tagIndex = process.argv.indexOf("--tag");
const explicitTag = tagIndex >= 0 ? process.argv[tagIndex + 1] : "";
if (tagIndex >= 0 && !explicitTag) throw new Error("--tagの後にvX.Y.Z形式のタグを指定してください。");
const environmentTag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : "";
const tag = explicitTag || environmentTag;
if (tag && tag !== `v${version}`) {
  throw new Error(`Gitタグ ${tag} とpackage.jsonのバージョン v${version} が一致しません。`);
}

console.log(`Version check passed: v${version}${tag ? ` = ${tag}` : ""}`);
