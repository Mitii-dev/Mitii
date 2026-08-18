/**
 * Bundled tags.scm sources injected by TreeSitterSourceParser.
 *
 * Adapted from aider's tree-sitter tags queries (MIT / Apache-2.0
 * grammar repos; see queries/README.md). Patterns are tuned for
 * web-tree-sitter grammars in `tree-sitter-wasms`:
 * - Prefer call/construct refs over blanket identifier reads.
 * - Tag `const`/`let` only when the value is a function.
 * - Keep aider capture names so the host runtime can inject either style.
 */

export const BUNDLED_TREE_SITTER_TAGS_QUERIES: Readonly<
  Record<string, string>
> = {
  python: `
(class_definition
  name: (identifier) @name.definition.class) @definition.class

(function_definition
  name: (identifier) @name.definition.function) @definition.function

(call
  function: [
    (identifier) @name.reference.call
    (attribute
      attribute: (identifier) @name.reference.call)
  ]) @reference.call
`,

  javascript: `
(class_declaration
  name: (identifier) @name.definition.class) @definition.class

(function_declaration
  name: (identifier) @name.definition.function) @definition.function

(generator_function_declaration
  name: (identifier) @name.definition.function) @definition.function

(method_definition
  name: (property_identifier) @name.definition.method) @definition.method

(lexical_declaration
  (variable_declarator
    name: (identifier) @name.definition.function
    value: [(arrow_function) (function_expression) (generator_function)])) @definition.function

(variable_declaration
  (variable_declarator
    name: (identifier) @name.definition.function
    value: [(arrow_function) (function_expression)])) @definition.function

(call_expression
  function: (identifier) @name.reference.call) @reference.call

(call_expression
  function: (member_expression
    property: (property_identifier) @name.reference.call)) @reference.call

(new_expression
  constructor: (identifier) @name.reference.construct) @reference.construct
`,

  typescript: `
(class_declaration
  name: (type_identifier) @name.definition.class) @definition.class

(abstract_class_declaration
  name: (type_identifier) @name.definition.class) @definition.class

(interface_declaration
  name: (type_identifier) @name.definition.interface) @definition.interface

(function_declaration
  name: (identifier) @name.definition.function) @definition.function

(generator_function_declaration
  name: (identifier) @name.definition.function) @definition.function

(method_definition
  name: (property_identifier) @name.definition.method) @definition.method

(type_alias_declaration
  name: (type_identifier) @name.definition.type) @definition.type

(enum_declaration
  name: (identifier) @name.definition.enum) @definition.enum

(lexical_declaration
  (variable_declarator
    name: (identifier) @name.definition.function
    value: [(arrow_function) (function_expression) (generator_function)])) @definition.function

(call_expression
  function: (identifier) @name.reference.call) @reference.call

(call_expression
  function: (member_expression
    property: (property_identifier) @name.reference.call)) @reference.call

(new_expression
  constructor: (identifier) @name.reference.construct) @reference.construct
`,

  tsx: `
(class_declaration
  name: (type_identifier) @name.definition.class) @definition.class

(interface_declaration
  name: (type_identifier) @name.definition.interface) @definition.interface

(function_declaration
  name: (identifier) @name.definition.function) @definition.function

(method_definition
  name: (property_identifier) @name.definition.method) @definition.method

(lexical_declaration
  (variable_declarator
    name: (identifier) @name.definition.function
    value: [(arrow_function) (function_expression) (generator_function)])) @definition.function

(call_expression
  function: (identifier) @name.reference.call) @reference.call

(call_expression
  function: (member_expression
    property: (property_identifier) @name.reference.call)) @reference.call

(new_expression
  constructor: (identifier) @name.reference.construct) @reference.construct
`,

  go: `
(function_declaration
  name: (identifier) @name.definition.function) @definition.function

(method_declaration
  name: (field_identifier) @name.definition.method) @definition.method

(type_spec
  name: (type_identifier) @name.definition.type) @definition.type

(call_expression
  function: [
    (identifier) @name.reference.call
    (selector_expression
      field: (field_identifier) @name.reference.call)
  ]) @reference.call
`,

  java: `
(class_declaration
  name: (identifier) @name.definition.class) @definition.class

(interface_declaration
  name: (identifier) @name.definition.interface) @definition.interface

(enum_declaration
  name: (identifier) @name.definition.enum) @definition.enum

(method_declaration
  name: (identifier) @name.definition.method) @definition.method

(method_invocation
  name: (identifier) @name.reference.call) @reference.call

(object_creation_expression
  type: (type_identifier) @name.reference.construct) @reference.construct
`,

  rust: `
(struct_item
  name: (type_identifier) @name.definition.class) @definition.class

(enum_item
  name: (type_identifier) @name.definition.class) @definition.class

(trait_item
  name: (type_identifier) @name.definition.interface) @definition.interface

(function_item
  name: (identifier) @name.definition.function) @definition.function

(impl_item
  (declaration_list
    (function_item
      name: (identifier) @name.definition.method))) @definition.method

(mod_item
  name: (identifier) @name.definition.module) @definition.module

(call_expression
  function: (identifier) @name.reference.call) @reference.call

(call_expression
  function: (field_expression
    field: (field_identifier) @name.reference.call)) @reference.call
`,

  c: `
(struct_specifier
  name: (type_identifier) @name.definition.class) @definition.class

(enum_specifier
  name: (type_identifier) @name.definition.type) @definition.type

(function_declarator
  declarator: (identifier) @name.definition.function) @definition.function

(call_expression
  function: (identifier) @name.reference.call) @reference.call
`,

  cpp: `
(class_specifier
  name: (type_identifier) @name.definition.class) @definition.class

(struct_specifier
  name: (type_identifier) @name.definition.class) @definition.class

(function_declarator
  declarator: (identifier) @name.definition.function) @definition.function

(call_expression
  function: (identifier) @name.reference.call) @reference.call
`,

  csharp: `
(class_declaration
  name: (identifier) @name.definition.class) @definition.class

(interface_declaration
  name: (identifier) @name.definition.interface) @definition.interface

(method_declaration
  name: (identifier) @name.definition.method) @definition.method

(namespace_declaration
  name: (identifier) @name.definition.module) @definition.module

(object_creation_expression
  type: (identifier) @name.reference.construct) @reference.construct

(invocation_expression
  function: (identifier) @name.reference.call) @reference.call

(invocation_expression
  function: (member_access_expression
    name: (identifier) @name.reference.call)) @reference.call
`,

  kotlin: `
(class_declaration
  (type_identifier) @name.definition.class) @definition.class

(object_declaration
  (type_identifier) @name.definition.object) @definition.object

(function_declaration
  (simple_identifier) @name.definition.function) @definition.function

(call_expression
  [
    (simple_identifier) @name.reference.call
    (navigation_expression
      (navigation_suffix
        (simple_identifier) @name.reference.call))
  ]) @reference.call
`,

  swift: `
(class_declaration
  name: (type_identifier) @name.definition.class) @definition.class

(struct_declaration
  name: (type_identifier) @name.definition.class) @definition.class

(enum_declaration
  name: (type_identifier) @name.definition.enum) @definition.enum

(protocol_declaration
  name: (type_identifier) @name.definition.interface) @definition.interface

(function_declaration
  name: (simple_identifier) @name.definition.function) @definition.function
`,

  ruby: `
(class
  name: (constant) @name.definition.class) @definition.class

(module
  name: (constant) @name.definition.module) @definition.module

(method
  name: (_) @name.definition.method) @definition.method

(singleton_method
  name: (_) @name.definition.method) @definition.method

(call
  method: (identifier) @name.reference.call) @reference.call
`,

  php: `
(class_declaration
  name: (name) @name.definition.class) @definition.class

(interface_declaration
  name: (name) @name.definition.interface) @definition.interface

(function_definition
  name: (name) @name.definition.function) @definition.function

(method_declaration
  name: (name) @name.definition.method) @definition.method

(function_call_expression
  function: [
    (name) @name.reference.call
    (qualified_name (name) @name.reference.call)
  ]) @reference.call

(member_call_expression
  name: (name) @name.reference.call) @reference.call
`,

  shell: `
(function_definition
  name: (word) @name.definition.function) @definition.function

(command
  name: (command_name) @name.reference.call) @reference.call
`,

  sql: `
(create_function
  (identifier) @name.definition.function) @definition.function

(create_table
  (identifier) @name.definition.class) @definition.class

(create_view
  (identifier) @name.definition.class) @definition.class
`,

  lua: `
(function_declaration
  name: [
    (identifier) @name.definition.function
    (dot_index_expression
      field: (identifier) @name.definition.function)
  ]) @definition.function

(function_declaration
  name: (method_index_expression
    method: (identifier) @name.definition.method)) @definition.method

(assignment_statement
  (variable_list .
    name: [
      (identifier) @name.definition.function
      (dot_index_expression
        field: (identifier) @name.definition.function)
    ])
  (expression_list .
    value: (function_definition))) @definition.function

(function_call
  name: [
    (identifier) @name.reference.call
    (dot_index_expression
      field: (identifier) @name.reference.call)
    (method_index_expression
      method: (identifier) @name.reference.call)
  ]) @reference.call
`,

  elixir: `
(call
  target: (identifier) @ignore
  (arguments (alias) @name.definition.module)
  (#any-of? @ignore "defmodule" "defprotocol")) @definition.module

(call
  target: (identifier) @ignore
  (arguments
    [
      (identifier) @name.definition.function
      (call target: (identifier) @name.definition.function)
      (binary_operator
        left: (call target: (identifier) @name.definition.function)
        operator: "when")
    ])
  (#any-of? @ignore "def" "defp" "defdelegate" "defmacro" "defmacrop")) @definition.function

(call
  target: [
    (identifier) @name.reference.call
    (dot right: (identifier) @name.reference.call)
  ]) @reference.call

(binary_operator
  operator: "|>"
  right: (identifier) @name.reference.call) @reference.call
`,

  dart: `
(class_definition
  name: (identifier) @name.definition.class) @definition.class

(enum_declaration
  name: (identifier) @name.definition.enum) @definition.enum

(function_signature
  name: (identifier) @name.definition.function) @definition.function

(method_signature
  (function_signature
    name: (identifier) @name.definition.method)) @definition.method

(new_expression
  (type_identifier) @name.reference.construct) @reference.construct
`,

  zig: `
(FnProto) @name.definition.function @definition.function
`,

  scala: `
(class_definition
  name: (identifier) @name.definition.class) @definition.class

(object_definition
  name: (identifier) @name.definition.object) @definition.object

(trait_definition
  name: (identifier) @name.definition.interface) @definition.interface

(function_definition
  name: (identifier) @name.definition.function) @definition.function

(enum_definition
  name: (identifier) @name.definition.enum) @definition.enum

(call_expression
  (identifier) @name.reference.call) @reference.call
`,

  haskell: `
(function
  (variable) @name.definition.function) @definition.function

(signature
  (variable) @name.definition.type) @definition.type
`,

  solidity: `
(contract_declaration
  name: (identifier) @name.definition.class) @definition.class

(interface_declaration
  name: (identifier) @name.definition.interface) @definition.interface

(function_definition
  name: (identifier) @name.definition.function) @definition.function

(call_expression
  (expression (identifier) @name.reference.call)) @reference.call

(call_expression
  (expression
    (member_expression
      property: (_) @name.reference.call))) @reference.call
`,
};
