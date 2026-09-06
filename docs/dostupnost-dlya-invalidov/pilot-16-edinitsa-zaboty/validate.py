#!/usr/bin/env python3
"""
validate.py — проверяет primer-*.json на соответствие care-unit.schema.json.

Это НЕ полноценный движок JSON Schema (для этого есть пакет `jsonschema` —
`pip install jsonschema`, если он нужен для более серьёзной задачи). Здесь —
компактный, зависимый только от стандартной библиотеки Python валидатор,
который понимает ровно то подмножество JSON Schema, что используется в
`care-unit.schema.json`: type, required, properties, additionalProperties,
items, minItems, enum, const. Такой же принцип "без внешних зависимостей",
как у generate_all.py в sites/pomosch-po-domu.

Использование:
    python3 validate.py
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

TYPE_MAP = {
    "object": dict,
    "array": list,
    "string": str,
    "number": (int, float),
    "integer": int,
    "boolean": bool,
}


def validate(instance, schema, path="$", errors=None):
    if errors is None:
        errors = []

    if "const" in schema and instance != schema["const"]:
        errors.append(f"{path}: ожидалось значение {schema['const']!r}, получено {instance!r}")

    if "enum" in schema and instance not in schema["enum"]:
        errors.append(f"{path}: {instance!r} не входит в допустимые {schema['enum']}")

    if "type" in schema:
        py_type = TYPE_MAP.get(schema["type"])
        if py_type and not isinstance(instance, py_type):
            errors.append(f"{path}: ожидался тип '{schema['type']}', получено {type(instance).__name__}")
            return errors  # дальше проверять бессмысленно — тип уже не тот

    if schema.get("type") == "object" and isinstance(instance, dict):
        for req in schema.get("required", []):
            if req not in instance:
                errors.append(f"{path}: отсутствует обязательное поле '{req}'")
        props = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            unknown = set(instance) - set(props)
            if unknown:
                errors.append(f"{path}: неизвестные поля {sorted(unknown)}")
        for key, sub_schema in props.items():
            if key in instance:
                validate(instance[key], sub_schema, f"{path}.{key}", errors)

    if schema.get("type") == "array" and isinstance(instance, list):
        min_items = schema.get("minItems")
        if min_items is not None and len(instance) < min_items:
            errors.append(f"{path}: массив короче minItems={min_items}")
        item_schema = schema.get("items")
        if item_schema:
            for i, item in enumerate(instance):
                validate(item, item_schema, f"{path}[{i}]", errors)

    return errors


def main():
    schema = json.loads((HERE / "care-unit.schema.json").read_text(encoding="utf-8"))
    examples = sorted(HERE.glob("primer-*.json"))
    if not examples:
        print("Не найдено ни одного primer-*.json", file=sys.stderr)
        return 1

    all_ok = True
    for example_path in examples:
        instance = json.loads(example_path.read_text(encoding="utf-8"))
        errors = validate(instance, schema)
        if errors:
            all_ok = False
            print(f"✗ {example_path.name}")
            for err in errors:
                print(f"    {err}")
        else:
            print(f"✓ {example_path.name} — соответствует care-unit.schema.json")

    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
