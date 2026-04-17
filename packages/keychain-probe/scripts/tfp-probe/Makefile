# Build three ad-hoc signed variants of the task_for_pid probe:
#   probe-bare          — no entitlements at all
#   probe-debugger      — com.apple.security.cs.debugger = true
#   probe-debugger-gta  — debugger + get-task-allow=true (caller-side)
#
# Run each against the PID of the running Kindle app (pgrep -x Kindle).

CFLAGS = -O2 -Wall -Wextra -Werror -arch arm64 -arch x86_64

.PHONY: all clean run-all

all: probe-bare probe-debugger probe-debugger-gta

probe-bare: probe.c
	clang $(CFLAGS) -o $@ $<
	codesign -f -s - $@

probe-debugger: probe.c probe-debugger.plist
	clang $(CFLAGS) -o $@ $<
	codesign -f -s - --entitlements probe-debugger.plist $@

probe-debugger-gta: probe.c probe-debugger-gta.plist
	clang $(CFLAGS) -o $@ $<
	codesign -f -s - --entitlements probe-debugger-gta.plist $@

run-all:
	@if [ -z "$$PID" ]; then \
	    echo "usage: make run-all PID=<pid>   (pgrep -x Kindle)"; \
	    exit 2; \
	fi; \
	echo; echo "=== probe-bare ==="; ./probe-bare $$PID; \
	echo; echo "=== probe-debugger ==="; ./probe-debugger $$PID; \
	echo; echo "=== probe-debugger-gta ==="; ./probe-debugger-gta $$PID

clean:
	rm -f probe-bare probe-debugger probe-debugger-gta
