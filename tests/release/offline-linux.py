import ctypes, errno, os, sys
lib = ctypes.CDLL('libseccomp.so.2', use_errno=True)
lib.seccomp_init.argtypes=[ctypes.c_uint32]; lib.seccomp_init.restype=ctypes.c_void_p
lib.seccomp_syscall_resolve_name.argtypes=[ctypes.c_char_p]; lib.seccomp_syscall_resolve_name.restype=ctypes.c_int
lib.seccomp_rule_add.argtypes=[ctypes.c_void_p,ctypes.c_uint32,ctypes.c_int,ctypes.c_uint];lib.seccomp_rule_add.restype=ctypes.c_int
lib.seccomp_load.argtypes=[ctypes.c_void_p];lib.seccomp_load.restype=ctypes.c_int
ctx=lib.seccomp_init(0x7fff0000)
if not ctx: raise RuntimeError('seccomp_init failed')
for name in ['socket','connect','sendto','sendmsg','sendmmsg','socketcall','io_uring_setup']:
    nr=lib.seccomp_syscall_resolve_name(name.encode())
    if nr >= 0:
        rc=lib.seccomp_rule_add(ctx,0x00050000 | errno.EPERM,nr,0)
        if rc != 0: raise RuntimeError((name,rc))
rc=lib.seccomp_load(ctx)
if rc != 0: raise RuntimeError(('seccomp_load',rc))
# Close inherited nonstandard descriptors: no pre-existing network socket escape.
os.closerange(3,1048576)
os.execvp(sys.argv[1],sys.argv[1:])
