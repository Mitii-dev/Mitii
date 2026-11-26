/** Soft fact ref used by mutate readiness (paths loaded evidence fallback). */
export type EstablishedFactRef = {
  id: string;
  content: string;
  paths?: readonly string[];
};
