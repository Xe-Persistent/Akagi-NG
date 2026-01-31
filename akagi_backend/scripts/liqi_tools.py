import argparse
import json
from pathlib import Path


def _handle_nested(name: str, obj: dict, indent: int, space: str) -> list[str]:
    lines = []
    if "fields" in obj:
        lines.append(f"{space}message {name} {{")
        lines.append(json_to_proto(obj, indent + 1))
        lines.append(f"{space}}}")
    elif "methods" in obj:
        lines.append(f"{space}service {name} {{")
        for m_name, m_obj in obj["methods"].items():
            req = m_obj["requestType"]
            res = m_obj["responseType"]
            lines.append(f"{space}  rpc {m_name}({req}) returns ({res});")
        lines.append(f"{space}}}")
    else:
        lines.append(f"package {name};")
        lines.append(json_to_proto(obj, indent))
    return lines


def _handle_fields(name: str, obj: dict, space: str) -> list[str]:
    lines = [f"{space}message {name} {{"]
    for f_name, f_obj in obj["fields"].items():
        rule = f"{f_obj['rule']} " if f_obj.get("rule") else ""
        lines.append(f"{space}  {rule}{f_obj['type']} {f_name} = {f_obj['id']};")
    lines.append(f"{space}}}")
    return lines


def _handle_values(name: str, obj: dict, space: str) -> list[str]:
    lines = [f"{space}enum {name} {{"]
    for v_name, v_id in obj["values"].items():
        lines.append(f"{space}  {v_name} = {v_id};")
    lines.append(f"{space}}}")
    return lines


def json_to_proto(json_data: dict, indent: int = 0) -> str:
    """
    Very basic converter from liqi.json (protobufjs format) back to a .proto file.
    """
    lines = []
    space = "  " * indent

    if "nested" not in json_data:
        return ""

    for name, obj in json_data["nested"].items():
        if "nested" in obj:
            lines.extend(_handle_nested(name, obj, indent, space))
        elif "fields" in obj:
            lines.extend(_handle_fields(name, obj, space))
        elif "values" in obj:
            lines.extend(_handle_values(name, obj, space))

    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Majsoul Liqi Protocol Tools")
    parser.add_argument("--json", type=str, help="Path to liqi.json")
    parser.add_argument("--export-proto", type=str, help="Path to save generated .proto file")

    args = parser.parse_args()

    if not args.json:
        script_dir = Path(__file__).parent
        json_path = script_dir.parent / "akagi_ng" / "assets" / "liqi.json"
    else:
        json_path = Path(args.json)

    if not json_path.exists():
        print(f"Error: liqi.json not found at {json_path}")
        return

    with open(json_path, encoding="utf-8") as f:
        data = json.load(f)

    if args.export_proto:
        proto_content = 'syntax = "proto3";\n\n' + json_to_proto(data)
        with open(args.export_proto, "w", encoding="utf-8") as f:
            f.write(proto_content)
        print(f"✅ Exported .proto to {args.export_proto}")
    else:
        print(f"Loaded protocol from {json_path}")
        if "nested" in data and "lq" in data["nested"]:
            lq = data["nested"]["lq"]["nested"]
            msgs = len([n for n, o in lq.items() if "fields" in o])
            svcs = len([n for n, o in lq.items() if "methods" in o])
            enms = len([n for n, o in lq.items() if "values" in o])
            print(f"Messages: {msgs}\nServices: {svcs}\nEnums:    {enms}")


if __name__ == "__main__":
    main()
