import Foundation
import Security

// MARK: - Helpers

func printJSON(_ obj: Any) {
    let data = try! JSONSerialization.data(
        withJSONObject: obj,
        options: [.prettyPrinted, .sortedKeys]
    )
    FileHandle.standardOutput.write(data)
    print()
}

func describeAttr(_ v: Any?) -> Any {
    guard let v = v else { return NSNull() }
    if let s = v as? String { return s }
    if let n = v as? NSNumber { return n }
    if let d = v as? Date { return ISO8601DateFormatter().string(from: d) }
    if let b = v as? Data {
        return [
            "length": b.count,
            "hex": b.map { String(format: "%02x", $0) }.joined().prefix(64),
        ] as [String: Any]
    }
    return "\(type(of: v))"
}

// MARK: - Commands

/// List generic-password services whose attributes give us any hint
/// (service, label, access group). Each item's secret data is NOT returned
/// here; we only enumerate keys.
func listAll() {
    // Note: on the data-protection keychain (kSecUseDataProtectionKeychain),
    // enumeration is limited to items the caller's entitlements permit.
    // Without a group entitlement, we see the caller's own items and items
    // with no access group restriction.
    let query: [CFString: Any] = [
        kSecClass: kSecClassGenericPassword,
        kSecMatchLimit: kSecMatchLimitAll,
        kSecReturnAttributes: true,
        kSecReturnRef: false,
        kSecUseDataProtectionKeychain: true,
    ]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    var out: [String: Any] = [
        "command": "list-all",
        "status": status,
        "statusMsg": SecCopyErrorMessageString(status, nil) as String? ?? "",
    ]
    if status == errSecSuccess, let arr = result as? [[String: Any]] {
        out["count"] = arr.count
        out["items"] = arr.map { item -> [String: Any] in
            var copy: [String: Any] = [:]
            for (k, v) in item {
                copy[k] = describeAttr(v)
            }
            return copy
        }
    }
    printJSON(out)
}

/// Try to enumerate items in the Amazon Lassen access group.
func listAccessGroup(_ group: String) {
    let query: [CFString: Any] = [
        kSecClass: kSecClassGenericPassword,
        kSecAttrAccessGroup: group,
        kSecMatchLimit: kSecMatchLimitAll,
        kSecReturnAttributes: true,
        kSecReturnRef: false,
        kSecUseDataProtectionKeychain: true,
    ]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    var out: [String: Any] = [
        "command": "list-group",
        "accessGroup": group,
        "status": status,
        "statusMsg": SecCopyErrorMessageString(status, nil) as String? ?? "",
    ]
    if status == errSecSuccess, let arr = result as? [[String: Any]] {
        out["count"] = arr.count
        out["items"] = arr.map { item -> [String: Any] in
            var copy: [String: Any] = [:]
            for (k, v) in item { copy[k] = describeAttr(v) }
            return copy
        }
    }
    printJSON(out)
}

/// Grep services/labels for a needle — safe surface-scan without reading data.
func grepServices(_ needle: String) {
    let query: [CFString: Any] = [
        kSecClass: kSecClassGenericPassword,
        kSecMatchLimit: kSecMatchLimitAll,
        kSecReturnAttributes: true,
        kSecUseDataProtectionKeychain: true,
    ]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    var out: [String: Any] = [
        "command": "grep",
        "needle": needle,
        "status": status,
        "statusMsg": SecCopyErrorMessageString(status, nil) as String? ?? "",
    ]
    guard status == errSecSuccess, let arr = result as? [[String: Any]] else {
        printJSON(out)
        return
    }
    let lower = needle.lowercased()
    let hits = arr.filter { item in
        let svc = (item[kSecAttrService as String] as? String ?? "").lowercased()
        let lbl = (item[kSecAttrLabel as String] as? String ?? "").lowercased()
        let acc = (item[kSecAttrAccount as String] as? String ?? "").lowercased()
        let grp = (item[kSecAttrAccessGroup as String] as? String ?? "").lowercased()
        return svc.contains(lower) || lbl.contains(lower) || acc.contains(lower) || grp.contains(lower)
    }
    out["totalItems"] = arr.count
    out["hits"] = hits.map { item -> [String: Any] in
        var copy: [String: Any] = [:]
        for (k, v) in item { copy[k] = describeAttr(v) }
        return copy
    }
    printJSON(out)
}

// MARK: - Dispatch

let args = CommandLine.arguments
let usage = """
  usage:
    keychain-probe list-all
    keychain-probe grep <needle>
    keychain-probe list-group <access-group>
"""

guard args.count >= 2 else {
    print(usage)
    exit(2)
}

switch args[1] {
case "list-all":
    listAll()
case "grep":
    guard args.count >= 3 else { print(usage); exit(2) }
    grepServices(args[2])
case "list-group":
    guard args.count >= 3 else { print(usage); exit(2) }
    listAccessGroup(args[2])
default:
    print(usage)
    exit(2)
}
