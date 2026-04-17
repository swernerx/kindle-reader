// probe.c — minimal task_for_pid tester.
//
// Used to empirically verify whether the `com.apple.security.cs.debugger`
// entitlement, when applied via ad-hoc codesigning, is sufficient for
// `task_for_pid` on a running third-party production app (hardened runtime,
// get-task-allow=false) under SIP=on macOS.
//
// Build and sign via the Makefile next to this file.
//
// usage: ./probe-<variant> <pid>
#include <mach/mach.h>
#include <mach/mach_error.h>
#include <stdio.h>
#include <stdlib.h>

int main(int argc, char **argv) {
    if (argc != 2) {
        fprintf(stderr, "usage: %s <pid>\n", argv[0]);
        return 2;
    }
    pid_t pid = (pid_t)atoi(argv[1]);
    if (pid <= 0) {
        fprintf(stderr, "bad pid: %s\n", argv[1]);
        return 2;
    }
    task_t task = MACH_PORT_NULL;
    kern_return_t kr = task_for_pid(mach_task_self(), pid, &task);
    if (kr != KERN_SUCCESS) {
        fprintf(stderr,
                "task_for_pid(%d) failed: kr=0x%x (%s)\n",
                pid, kr, mach_error_string(kr));
        return 1;
    }
    printf("task_for_pid(%d) = 0x%x  SUCCESS\n", pid, task);
    return 0;
}
