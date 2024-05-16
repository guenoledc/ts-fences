import ts from "typescript";
import GlobToRegExp from "glob-to-regexp";
import fs from "node:fs";
import path from "node:path";
function createParseConfigHost() {
    const h = ts.createCompilerHost({});
    return {
        ...h,
        readDirectory: h.readDirectory,
        useCaseSensitiveFileNames: h.useCaseSensitiveFileNames()
    };
}
function createCompilerHostWithFileCollection(opt) {
    const host = ts.createCompilerHost(opt);
    const fileMap = new Map();
    const resolveModuleNameLiterals = (moduleLiterals, containingFile, redirectedReference, options, containingSourceFile, reusedNames) => {
        fileMap.has(containingFile) || fileMap.set(containingFile, { imported: [], name: containingFile, layers: [] });
        const fileRef = fileMap.get(containingFile);
        const res = [];
        for (const m of moduleLiterals) {
            let r;
            r = ts.resolveModuleName(m.text, containingFile, options, host, undefined, redirectedReference);
            if (r.resolvedModule) {
                const importedFile = r.resolvedModule.resolvedFileName;
                fileRef.imported.push(importedFile);
                fileMap.has(importedFile) || fileMap.set(importedFile, { imported: [], name: importedFile, layers: [] });
            }
            else {
                fileRef.imported.push(m.text);
            }
            res.push(r);
        }
        return res;
    };
    return {
        ...host,
        resolveModuleNameLiterals,
        files: fileMap
    };
}
function findPackageJson(fromDir) {
    const currentDir = fromDir || process.cwd();
    let dir = currentDir;
    while (dir !== "/") {
        const packageJsonPath = path.join(dir, "package.json");
        if (fs.existsSync(packageJsonPath)) {
            return packageJsonPath;
        }
        dir = path.dirname(dir);
    }
    return undefined;
}
function loadStructureConfig(path) {
    const pkgJson = findPackageJson(path);
    if (pkgJson) {
        const packageJsonContent = fs.readFileSync(pkgJson, "utf-8");
        const packageJson = JSON.parse(packageJsonContent);
        return packageJson.structure;
    }
    return undefined;
}
function loadProjectConfig(path) {
    const basePath = path || process.cwd();
    const hostForConfig = createParseConfigHost();
    const configFileName = ts.findConfigFile(basePath, hostForConfig.fileExists);
    if (!configFileName)
        throw new Error("No config file found");
    const configContent = hostForConfig.readFile(configFileName);
    if (!configContent)
        throw new Error("Cannot read the content of " + configFileName);
    const configSourceFile = ts.parseJsonText(configFileName, configContent);
    const parsedCmdLine = ts.parseJsonSourceFileConfigFileContent(configSourceFile, hostForConfig, basePath, undefined, configFileName);
    return parsedCmdLine;
}
function filterExclusion(fileMap, config) {
    const excludeRe = (config.exclude || ["node_modules"]).map(e => GlobToRegExp(e, { extended: false, globstar: true, flags: "g" })).map(re => new RegExp(re.source, ""));
    const files = Array.from(fileMap.keys()).filter(f => !excludeRe.some(re => re.test(f)));
    return files;
}
function setFileLayers(files, map, config) {
    for (const f of files) {
        const fileRef = map.get(f);
        for (const layer of config.layers) {
            if (layer.files.some(p => GlobToRegExp(`**/${p}`, { extended: true, globstar: true }).test(f))) {
                fileRef.layers.push(layer.name);
            }
        }
    }
}
function checkImportCompliance(files, map, config) {
    for (const f of files) {
        const fileRef = map.get(f);
        for (const imported of fileRef.imported) {
            const importedRef = map.get(imported);
            if (!importedRef)
                continue;
            const importedLayers = importedRef.layers;
            const allowedLayers = config.layers.filter(l => fileRef.layers.includes(l.name)).flatMap(l => l.allowImports);
            const forbiddenLayers = importedLayers.filter(l => !allowedLayers.includes(l));
            if (forbiddenLayers.length > 0) {
                fileRef.diagnostics || (fileRef.diagnostics = []);
                fileRef.diagnostics.push({
                    source: f, imported, allowed: allowedLayers, forbidden: forbiddenLayers,
                    diagnosticText: `"${f}" in layer(s) "${fileRef.layers.join(', ')}" imports "${imported}" from layer(s) "${importedLayers.join(', ')}". Layer(s) "${forbiddenLayers.join(', ')}" not allowed. Only import from "${allowedLayers.join(', ')}" layer(s)`
                });
            }
        }
    }
}
function getDiagnostics(map) {
    return Array.from(map.values()).filter(f => f.diagnostics).flatMap(f => f.diagnostics).filter(d => d);
}
export function checkProjectStructure(basePath) {
    const parsedCmdLine = loadProjectConfig(basePath);
    let structureConfig = loadStructureConfig(basePath);
    if (!structureConfig) {
        console.warn("WARN: No structure config found in package.json. Using a default one. You should add a 'structure' field in your package.json following type ProjectStructureConfig.");
        structureConfig = {
            layers: []
        };
    }
    const host = createCompilerHostWithFileCollection(parsedCmdLine.options);
    ts.createProgram({
        rootNames: parsedCmdLine.fileNames,
        options: parsedCmdLine.options,
        host
    });
    const fileMap = host.files;
    const files = filterExclusion(fileMap, structureConfig);
    setFileLayers(files, fileMap, structureConfig);
    checkImportCompliance(files, fileMap, structureConfig);
    return getDiagnostics(fileMap);
}
//# sourceMappingURL=index.js.map