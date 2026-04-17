# @kindle/keychain-probe

Swift-CLI-Helper, der Keychain-Items aus der AppGroup `group.com.amazon.Lassen` abfragt und als JSON nach stdout emittiert. Aus TS über `child_process.spawn` aufgerufen.

Implementierung folgt in **Phase 2**.

## Geplante Sub-Commands

```
keychain-probe list           # alle erreichbaren Items enumeriere
keychain-probe get <service>  # ein Item per Service-Name
keychain-probe parse-voucher <path>  # bplist-Voucher → JSON
```

## Build (vorgesehen)

```
swift build -c release
./.build/release/keychain-probe list
```
