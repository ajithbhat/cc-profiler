declare module "pidusage" {
  export interface PidusageStat {
    cpu: number;
    memory: number;
    ctime?: number;
    elapsed?: number;
    ppid?: number;
    pid?: number;
    timestamp?: number;
  }

  export type PidusageCallback = (err: unknown, stat: PidusageStat) => void;

  export interface PidusageFn {
    (pid: number, callback: PidusageCallback): void;
    clear(): void;
  }

  const pidusage: PidusageFn;
  export default pidusage;
}
