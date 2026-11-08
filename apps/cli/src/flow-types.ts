import type { InstallationState } from './inspection.js';

export type Choice = 'open' | 'repair' | 'exit' | 'keep' | 'delete';
export interface Terminal {
  intro(message: string): void;
  note(message: string, title: string): void;
  confirm(
    message: string,
    yes: string,
    no: string,
  ): Promise<boolean | undefined>;
  select(
    message: string,
    options: { value: Choice; label: string }[],
  ): Promise<Choice | undefined>;
  progress(message: string): { stop(message: string): void };
  end(message: string): void;
  error(message: string): void;
}
export interface Actions {
  inspect(removing: boolean): Promise<InstallationState>;
  install(state: InstallationState): Promise<{
    mode: 'install' | 'update' | 'repair';
    browserOpened: boolean;
    managementUrl: string;
  }>;
  open(state: InstallationState): Promise<{
    browserOpened: boolean;
    managementUrl: string;
  }>;
  uninstall(state: InstallationState, removeData: boolean): Promise<void>;
}
