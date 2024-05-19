# ts-fences
Solution to control the imports in typescript project ensuring consistency with custom rules

## Motivations

Large projects need to have a good organization of the code and code structure becomes hard to maintain in a multi developper environment, in particular with turnover.

This small tool is opinionated to enforce typescript project code structure, in particular when one want to see the hexagonal architecture (dependency inversion) well respected and prevent developpers to make shortcuts.

## Principles

The code of a project is organized in layers. Each layer has its own responsibility and should not depend on other layers. Some layers have the rights to import some other and some should not.

Layers exposes some modules and may want to keep other privates.

## Installation

```bash
npm install -g ts-fences
```
Or install as a development tool in your project with 
```bash
npm install -D ts-fences
```

## Configuration

The `ts-fences` script looks for 
- the `package.json` file in the current directory and above and extract the configuration from the `structure` field
- the `tsconfig.json` file in the current directory and above to interpret the typescript compilation options, since the script uses the typescript compiler to parse the code.

The configuration in `structure` inside the `package.json` file is an object with the following fields:

- `layers`: a map of layers (`name`=>`layer`) with the following fields:
  - `files`: an array of glob patterns to match the files of the layer
  - `allowImports`: an array of layer names that are allowed to be imported by this layer. When not defined, any layer can be imported.
  - `export`: an array of glob patterns to define the modules that are exported by the layer. When not defined, all modules are exported.
- `exclude`: (optional) an array of glob patterns to exclude files from the analysis
- `traceFile`: (optional) the name of a file where to write the trace of the analysis
- `ignoreCycles`: (optional) boolean to indicate if the script should ignore cycles in the dependencies

Files that are not included in any layer are allowed to import any layer and can import any module. So an empty configuration will always pass.

## Use programmatically

The script can be used programmatically in a nodejs script. Here is an example:

```javascript
const { checkProjectStructure } = require('ts-fences');
const diags = checkProjectStructure("path/to/project"); // or no parameter to use the current directory
if (diags.length > 0) {
  console.error(diags.map(d=>d.diagnosticText).join("\n"));
  process.exit(1);
}
```

## Example

Here is an example of a `package.json` file with a `structure` field:

```json
{
  "name": "my-project",
  "version": "1.0.0",
  "devDependencies": {
    "ts-fences": "^0.2.0"
  },
  "scripts": {
    "fences": "ts-fences"
  },
  "structure": {
    "layers": {
      "domain": {
        "files": ["src/domain/**/*.ts"],
        "allowImports": ["infrastructure"],
        "export": ["index.ts"]
      },
      "application": {
        "files": ["src/application/**/*.ts"],
        "allowImports": ["domain"],
        "export": ["module1.ts", "module2.ts"]
      },
      "infrastructure": {
        "files": ["src/infrastructure/**/*.ts"],
        "allowImports": ["domain", "application"]
      }
    },
    "exclude": ["**/*.spec.ts"],
    "traceFile": "trace.json",
    "ignoreCycles": false
  }
}
```

```bash
npm run fences
```

## Inspiration

Thanks to the projects `good-fences` and `depedency-cruiser` for the inspiration.

* good-fences: works with files in every folder. And it is not as flexible as I wanted.
* dependency-cruiser: display graphs of dependencies. But it doesnt not enable custom rules definitions.