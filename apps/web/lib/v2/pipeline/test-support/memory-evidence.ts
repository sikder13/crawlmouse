/**
 * An EvidenceStore in memory, for the pipeline's tests and the live run (D14): a put replaces, a get
 * of a missing path throws as Storage's download does, and a listing names the objects directly in
 * a directory.
 */
import type { EvidenceDirectory } from '../evidence';
import type { EvidenceStore } from '../types';

export function memoryEvidenceStore(): EvidenceStore &
  EvidenceDirectory & {
    readonly objects: Map<string, Uint8Array>;
  } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async put(path, gzipped) {
      objects.set(path, new Uint8Array(gzipped));
    },
    async get(path) {
      const found = objects.get(path);
      if (!found) throw new Error(`evidence: get ${path}: not found`);
      return found;
    },
    async remove(paths) {
      for (const p of paths) objects.delete(p);
    },
    async list(dir) {
      const inDir = (p: string) =>
        p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/');
      return [...objects.keys()].filter(inDir).sort();
    },
  };
}
