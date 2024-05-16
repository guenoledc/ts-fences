import ts from "typescript"
import GlobToRegExp from "glob-to-regexp";
import fs from "node:fs";
import path from "node:path";


export interface ProjectStructureLayer {
  name: string;
  files: string[];
  allowImports: string[];
}

export interface ProjectStructureConfig {
  layers: ProjectStructureLayer[];
  exclude?: string[];
}

export interface ImportDiagnostic {
  source: string;
  imported: string;
  allowed: string[];
  forbidden: string[];
  diagnosticText: string;
}

export interface FileRef {
  name: string;
  imported: string[];
  layers: string[];
  diagnostics?: ImportDiagnostic[];
}
// const fileMap = new Map<string, FileRef>();

function createParseConfigHost(): ts.ParseConfigHost {
  const h = ts.createCompilerHost({});
  return {
    ...h,
    readDirectory: h.readDirectory!,
    useCaseSensitiveFileNames: h.useCaseSensitiveFileNames()
  }
}


interface CompilerHostWithFileCollection extends ts.CompilerHost {
  files: Map<string, FileRef>
}

function createCompilerHostWithFileCollection(opt: ts.CompilerOptions): CompilerHostWithFileCollection {
  const host = ts.createCompilerHost(opt);
  const fileMap = new Map<string, FileRef>();
  const resolveModuleNameLiterals = (moduleLiterals: readonly ts.StringLiteralLike[], containingFile: string, redirectedReference: ts.ResolvedProjectReference | undefined, options: ts.CompilerOptions, containingSourceFile: ts.SourceFile, reusedNames: readonly ts.StringLiteralLike[] | undefined): readonly ts.ResolvedModuleWithFailedLookupLocations[] => {
    fileMap.has(containingFile) || fileMap.set(containingFile, {imported: [], name: containingFile, layers: []});
    const fileRef = fileMap.get(containingFile)!;
    const res: ts.ResolvedModuleWithFailedLookupLocations[] = [];
    // if (host.resolveModuleNameLiterals) {
    //   res.push( ...host.resolveModuleNameLiterals(moduleLiterals, containingFile, redirectedReference, options, containingSourceFile, reusedNames) );
    //   for(let i=0; i<moduleLiterals.length; i++) {
    //     console.log("Resolved:", moduleLiterals[i].text, "in", containingFile, "==>", res[i].resolvedModule?.resolvedFileName);
    //   }
      
    // } else {
      for(const m of moduleLiterals) {
        let r: ts.ResolvedModuleWithFailedLookupLocations;
        r=ts.resolveModuleName(m.text, containingFile, options, host, undefined, redirectedReference )
        // console.log("resolved:", m.text, "in", containingFile, "==>", r.resolvedModule?.resolvedFileName);
        if (r.resolvedModule) {
          const importedFile = r.resolvedModule.resolvedFileName;
          fileRef.imported.push(importedFile);
          fileMap.has(importedFile) || fileMap.set(importedFile, {imported: [], name: importedFile, layers: []});
        } else {
          fileRef.imported.push(m.text);
          // fileMap.has(m.text) || fileMap.set(m.text, {imported: [], name: m.text, layers: []});
        }
        res.push(r);
      }
    // }
    return res;
  }
  return {
    ...host,
    resolveModuleNameLiterals,
    files: fileMap
  }
  
}


// create a function that finds the package.json in the current folder or the folders below
function findPackageJson(fromDir?: string): string | undefined {
  const currentDir = fromDir||process.cwd();

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

function loadStructureConfig(path: string): ProjectStructureConfig|undefined {
  const pkgJson = findPackageJson(path);
  // console.log("Found package.json", pkgJson);
  // extract the field "structure" from the package.json as a js object
  if (pkgJson) {
    const packageJsonContent = fs.readFileSync(pkgJson, "utf-8");
    const packageJson = JSON.parse(packageJsonContent);
    return packageJson.structure;
  }
  return undefined;
}

function loadProjectConfig(path?: string) {
  const basePath = path || process.cwd();
  const hostForConfig = createParseConfigHost();
  const configFileName = ts.findConfigFile(basePath, hostForConfig.fileExists);
  if (!configFileName) throw new Error("No config file found");
  const configContent = hostForConfig.readFile(configFileName);
  if (!configContent) throw new Error("Cannot read the content of " + configFileName);
  const configSourceFile: ts.TsConfigSourceFile = ts.parseJsonText(configFileName, configContent);
  const parsedCmdLine = ts.parseJsonSourceFileConfigFileContent(configSourceFile, hostForConfig, basePath, undefined, configFileName);
  return parsedCmdLine;
}


function filterExclusion(fileMap:Map<string, FileRef>, config: ProjectStructureConfig) {
  // create the exclude regexes created with the global flag and global flag removed so it tests the whole string once
  const excludeRe = (config.exclude || ["node_modules"]).map(e => GlobToRegExp(e, { extended: false, globstar: true, flags: "g" })).map(re => new RegExp(re.source, ""));
  // we want to exclude all files that match any of the exclude patterns
  const files = Array.from(fileMap.keys()).filter(f => !excludeRe.some(re => re.test(f)));
  return files;
}



function setFileLayers(files: string[], map: Map<string, FileRef>, config: ProjectStructureConfig) {
  // parse the files to tag the layer
  for(const f of files) {
    const fileRef = map.get(f)!;
    for(const layer of config.layers) {
      if ( layer.files.some(p=>GlobToRegExp(`**/${p}`, {extended: true, globstar: true}).test(f)) ) {
        fileRef.layers.push(layer.name);
      }
    }
  }
}

function checkImportCompliance(files: string[], map:Map<string, FileRef>, config: ProjectStructureConfig ) {
  
  // parse the files to check the imports
  for(const f of files) {
    const fileRef = map.get(f)!;
    // check the imported files and modules
    for(const imported of fileRef.imported) {
      const importedRef = map.get(imported);
      if (!importedRef) continue;
      // the layers of the imported file must be allowed by the current file
      const importedLayers = importedRef.layers;
      const allowedLayers = config.layers.filter(l=>fileRef.layers.includes(l.name)).flatMap(l=>l.allowImports);
      const forbiddenLayers = importedLayers.filter(l=>!allowedLayers.includes(l));
      if (forbiddenLayers.length>0) {
        // console.log("Forbidden import", f, "imports", imported, importedLayers, "from layers", allowedLayers, "forbidden layers", forbiddenLayers);
        fileRef.diagnostics || (fileRef.diagnostics = []);
        fileRef.diagnostics.push({
          source: f, imported, allowed: allowedLayers, forbidden: forbiddenLayers,
          diagnosticText: `"${f}" in layer(s) "${fileRef.layers.join(', ')}" imports "${imported}" from layer(s) "${importedLayers.join(', ')}". Layer(s) "${forbiddenLayers.join(', ')}" not allowed. Only import from "${allowedLayers.join(', ')}" layer(s)`
        });
      } 
      // else {
      //   console.log("Allowed import", f, "imports", imported);
      // }
    }
  }

}

function getDiagnostics(map: Map<string, FileRef> ): ImportDiagnostic[] {
  return Array.from(map.values()).filter(f => f!.diagnostics).flatMap(f => f!.diagnostics).filter(d => d) as any;
}

// const conf: ProjectStructureConfig = {
//   layers: [
//     {
//       name: "domain",
//       files: ["src/domain/*.ts"],
//       allowImports: []
//     },
//     {
//       name: "business",
//       files: ["src/business/*.ts"],
//       allowImports: ["domainx"]
//     },
//     {
//       name: "root",
//       files: ["src/index.ts"],
//       allowImports: ["business", "domain"]
//     }
//   ],
//   exclude: ["node_modules", "*.d.ts"]
// }


export function checkProjectStructure(basePath: string) {
  
  const parsedCmdLine = loadProjectConfig(basePath);

  let structureConfig = loadStructureConfig(basePath);
  if (!structureConfig) { // make a default config
    console.warn("WARN: No structure config found in package.json. Using a default one. You should add a 'structure' field in your package.json following type ProjectStructureConfig.");
    structureConfig = {
      layers: []
    }
  }

  const host = createCompilerHostWithFileCollection(parsedCmdLine.options);
  // run the compilation of the files, filling host.files
  ts.createProgram({
    rootNames: parsedCmdLine.fileNames,
    options: parsedCmdLine.options,
    host
  })


  const fileMap = host.files;

  const files = filterExclusion(fileMap, structureConfig);

  setFileLayers(files, fileMap, structureConfig);
  checkImportCompliance(files, fileMap, structureConfig);
  return getDiagnostics(fileMap);
}


// const basePath = "/Users/guenole/VSCode/learn-tsc-api/to-parse";
// const diagnostics = checkProjectStructure(basePath);
// console.log("Diagnostics:\n" + diagnostics.map(d=>d.diagnosticText).join("\n"));




