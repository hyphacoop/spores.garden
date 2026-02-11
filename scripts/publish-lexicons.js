import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const lexiconsDir = path.join(rootDir, 'lexicons');
const publicDir = path.join(rootDir, 'public');

// Ensure directories exist
const publicLexiconsDir = path.join(publicDir, 'lexicons');
const wellKnownDir = path.join(publicDir, '.well-known');
const atProtoLexiconDir = path.join(wellKnownDir, 'atproto-lexicon');

[publicLexiconsDir, atProtoLexiconDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Recursively find all JSON files in lexicons directory
function findJsonFiles(dir) {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...findJsonFiles(fullPath));
        } else if (entry.name.endsWith('.json')) {
            results.push(fullPath);
        }
    }
    return results;
}

const files = findJsonFiles(lexiconsDir);
const bundle = [];

console.log(`Publishing ${files.length} lexicons...`);

files.forEach(srcPath => {
    const content = fs.readFileSync(srcPath, 'utf8');
    const json = JSON.parse(content);
    bundle.push(json);

    // Read NSID from the JSON id field
    const nsid = json.id;
    if (!nsid) {
        console.warn(`  WARNING: No id field in ${srcPath}, skipping`);
        return;
    }

    // 1. /lexicons/<nsid>.json
    const legacyDest = path.join(publicLexiconsDir, `${nsid}.json`);
    fs.writeFileSync(legacyDest, content);

    // 2. /.well-known/atproto-lexicon/<nsid> and .json alias
    const rfcDest = path.join(atProtoLexiconDir, nsid);
    const rfcDestJson = path.join(atProtoLexiconDir, `${nsid}.json`);
    fs.writeFileSync(rfcDest, content); // Write content without extension
    fs.writeFileSync(rfcDestJson, content);

    console.log(`  - ${nsid}`);
});

// 3. /.well-known/atproto-lexicons (bundle)
const bundlePath = path.join(wellKnownDir, 'atproto-lexicons');
const bundlePathJson = path.join(wellKnownDir, 'atproto-lexicons.json');
const bundleContent = JSON.stringify(bundle, null, 2);
fs.writeFileSync(bundlePath, bundleContent);
fs.writeFileSync(bundlePathJson, bundleContent);
console.log(`  - Bundle written to ${bundlePath}`);

console.log('Done!');
