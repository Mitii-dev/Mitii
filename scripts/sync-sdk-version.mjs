import { readFileSync, writeFileSync } from 'fs';

const rootPackagePath = new URL('../package.json', import.meta.url);
const sdkPackagePath = new URL('../packages/sdk/package.json', import.meta.url);

const rootPackage = JSON.parse(readFileSync(rootPackagePath, 'utf8'));
const sdkPackage = JSON.parse(readFileSync(sdkPackagePath, 'utf8'));

sdkPackage.version = rootPackage.version;
writeFileSync(sdkPackagePath, `${JSON.stringify(sdkPackage, null, 2)}\n`);
console.log(`@mitii/sdk version synced to ${rootPackage.version}`);
