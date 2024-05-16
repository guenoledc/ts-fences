/// <reference--- path="../node_modules/@types/node/path.d.ts" />
import path from 'node:path';
import { IBL } from './domain';
import { BL } from './business';
import {} from "typescript";

console.log(path.join("local", 'index.ts'));

const bl: IBL = new BL();