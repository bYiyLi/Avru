export function command(args: readonly string[]): {
  code: number;
  message: string;
} {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    return {
      code: 0,
      message:
        'Avru development scaffold\nUsage: avru --help | --version\nInstallation, upgrade and uninstall are not implemented.',
    };
  }
  if (args.length === 1 && args[0] === '--version') {
    return { code: 0, message: '0.0.0 (unreleased scaffold)' };
  }
  return {
    code: 1,
    message:
      'Avru is not installable yet. No system changes were made. Use --help.',
  };
}
