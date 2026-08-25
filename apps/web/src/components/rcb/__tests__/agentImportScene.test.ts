import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAndValidateSceneJson } from '@/components/rcb/sceneNode';

const exportDir = path.resolve(__dirname, '../../../../../../.tmp-agent-export');

describe('agent smoke IMPORT_* scene json', () => {
  for (const name of ['IMPORT_no_ref_scene.json', 'IMPORT_with_ref_scene.json']) {
    it(`validates ${name}`, () => {
      const p = path.join(exportDir, name);
      if (!fs.existsSync(p)) {
        expect.fail(`missing ${p}`);
      }
      const result = parseAndValidateSceneJson(fs.readFileSync(p, 'utf8'));
      if (!result.valid) {
        console.error(name, result.error);
      }
      expect(result.valid).toBe(true);
    });
  }
});
