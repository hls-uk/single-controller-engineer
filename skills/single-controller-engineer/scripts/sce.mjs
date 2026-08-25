#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/codegen/code.js
var require_code = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/codegen/code.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.regexpCode = exports.getEsmExportName = exports.getProperty = exports.safeStringify = exports.stringify = exports.strConcat = exports.addCodeArg = exports.str = exports._ = exports.nil = exports._Code = exports.Name = exports.IDENTIFIER = exports._CodeOrName = void 0;
    var _CodeOrName = class {
    };
    exports._CodeOrName = _CodeOrName;
    exports.IDENTIFIER = /^[a-z$_][a-z$_0-9]*$/i;
    var Name = class extends _CodeOrName {
      constructor(s) {
        super();
        if (!exports.IDENTIFIER.test(s))
          throw new Error("CodeGen: name must be a valid identifier");
        this.str = s;
      }
      toString() {
        return this.str;
      }
      emptyStr() {
        return false;
      }
      get names() {
        return { [this.str]: 1 };
      }
    };
    exports.Name = Name;
    var _Code = class extends _CodeOrName {
      constructor(code) {
        super();
        this._items = typeof code === "string" ? [code] : code;
      }
      toString() {
        return this.str;
      }
      emptyStr() {
        if (this._items.length > 1)
          return false;
        const item = this._items[0];
        return item === "" || item === '""';
      }
      get str() {
        var _a;
        return (_a = this._str) !== null && _a !== void 0 ? _a : this._str = this._items.reduce((s, c) => `${s}${c}`, "");
      }
      get names() {
        var _a;
        return (_a = this._names) !== null && _a !== void 0 ? _a : this._names = this._items.reduce((names, c) => {
          if (c instanceof Name)
            names[c.str] = (names[c.str] || 0) + 1;
          return names;
        }, {});
      }
    };
    exports._Code = _Code;
    exports.nil = new _Code("");
    function _(strs, ...args) {
      const code = [strs[0]];
      let i = 0;
      while (i < args.length) {
        addCodeArg(code, args[i]);
        code.push(strs[++i]);
      }
      return new _Code(code);
    }
    exports._ = _;
    var plus = new _Code("+");
    function str(strs, ...args) {
      const expr = [safeStringify(strs[0])];
      let i = 0;
      while (i < args.length) {
        expr.push(plus);
        addCodeArg(expr, args[i]);
        expr.push(plus, safeStringify(strs[++i]));
      }
      optimize(expr);
      return new _Code(expr);
    }
    exports.str = str;
    function addCodeArg(code, arg) {
      if (arg instanceof _Code)
        code.push(...arg._items);
      else if (arg instanceof Name)
        code.push(arg);
      else
        code.push(interpolate(arg));
    }
    exports.addCodeArg = addCodeArg;
    function optimize(expr) {
      let i = 1;
      while (i < expr.length - 1) {
        if (expr[i] === plus) {
          const res = mergeExprItems(expr[i - 1], expr[i + 1]);
          if (res !== void 0) {
            expr.splice(i - 1, 3, res);
            continue;
          }
          expr[i++] = "+";
        }
        i++;
      }
    }
    function mergeExprItems(a, b) {
      if (b === '""')
        return a;
      if (a === '""')
        return b;
      if (typeof a == "string") {
        if (b instanceof Name || a[a.length - 1] !== '"')
          return;
        if (typeof b != "string")
          return `${a.slice(0, -1)}${b}"`;
        if (b[0] === '"')
          return a.slice(0, -1) + b.slice(1);
        return;
      }
      if (typeof b == "string" && b[0] === '"' && !(a instanceof Name))
        return `"${a}${b.slice(1)}`;
      return;
    }
    function strConcat(c1, c2) {
      return c2.emptyStr() ? c1 : c1.emptyStr() ? c2 : str`${c1}${c2}`;
    }
    exports.strConcat = strConcat;
    function interpolate(x) {
      return typeof x == "number" || typeof x == "boolean" || x === null ? x : safeStringify(Array.isArray(x) ? x.join(",") : x);
    }
    function stringify(x) {
      return new _Code(safeStringify(x));
    }
    exports.stringify = stringify;
    function safeStringify(x) {
      return JSON.stringify(x).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    }
    exports.safeStringify = safeStringify;
    function getProperty(key) {
      return typeof key == "string" && exports.IDENTIFIER.test(key) ? new _Code(`.${key}`) : _`[${key}]`;
    }
    exports.getProperty = getProperty;
    function getEsmExportName(key) {
      if (typeof key == "string" && exports.IDENTIFIER.test(key)) {
        return new _Code(`${key}`);
      }
      throw new Error(`CodeGen: invalid export name: ${key}, use explicit $id name mapping`);
    }
    exports.getEsmExportName = getEsmExportName;
    function regexpCode(rx) {
      return new _Code(rx.toString());
    }
    exports.regexpCode = regexpCode;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/codegen/scope.js
var require_scope = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/codegen/scope.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ValueScope = exports.ValueScopeName = exports.Scope = exports.varKinds = exports.UsedValueState = void 0;
    var code_1 = require_code();
    var ValueError = class extends Error {
      constructor(name) {
        super(`CodeGen: "code" for ${name} not defined`);
        this.value = name.value;
      }
    };
    var UsedValueState;
    (function(UsedValueState2) {
      UsedValueState2[UsedValueState2["Started"] = 0] = "Started";
      UsedValueState2[UsedValueState2["Completed"] = 1] = "Completed";
    })(UsedValueState || (exports.UsedValueState = UsedValueState = {}));
    exports.varKinds = {
      const: new code_1.Name("const"),
      let: new code_1.Name("let"),
      var: new code_1.Name("var")
    };
    var Scope = class {
      constructor({ prefixes, parent } = {}) {
        this._names = {};
        this._prefixes = prefixes;
        this._parent = parent;
      }
      toName(nameOrPrefix) {
        return nameOrPrefix instanceof code_1.Name ? nameOrPrefix : this.name(nameOrPrefix);
      }
      name(prefix) {
        return new code_1.Name(this._newName(prefix));
      }
      _newName(prefix) {
        const ng = this._names[prefix] || this._nameGroup(prefix);
        return `${prefix}${ng.index++}`;
      }
      _nameGroup(prefix) {
        var _a, _b;
        if (((_b = (_a = this._parent) === null || _a === void 0 ? void 0 : _a._prefixes) === null || _b === void 0 ? void 0 : _b.has(prefix)) || this._prefixes && !this._prefixes.has(prefix)) {
          throw new Error(`CodeGen: prefix "${prefix}" is not allowed in this scope`);
        }
        return this._names[prefix] = { prefix, index: 0 };
      }
    };
    exports.Scope = Scope;
    var ValueScopeName = class extends code_1.Name {
      constructor(prefix, nameStr) {
        super(nameStr);
        this.prefix = prefix;
      }
      setValue(value, { property, itemIndex }) {
        this.value = value;
        this.scopePath = (0, code_1._)`.${new code_1.Name(property)}[${itemIndex}]`;
      }
    };
    exports.ValueScopeName = ValueScopeName;
    var line = (0, code_1._)`\n`;
    var ValueScope = class extends Scope {
      constructor(opts) {
        super(opts);
        this._values = {};
        this._scope = opts.scope;
        this.opts = { ...opts, _n: opts.lines ? line : code_1.nil };
      }
      get() {
        return this._scope;
      }
      name(prefix) {
        return new ValueScopeName(prefix, this._newName(prefix));
      }
      value(nameOrPrefix, value) {
        var _a;
        if (value.ref === void 0)
          throw new Error("CodeGen: ref must be passed in value");
        const name = this.toName(nameOrPrefix);
        const { prefix } = name;
        const valueKey = (_a = value.key) !== null && _a !== void 0 ? _a : value.ref;
        let vs = this._values[prefix];
        if (vs) {
          const _name = vs.get(valueKey);
          if (_name)
            return _name;
        } else {
          vs = this._values[prefix] = /* @__PURE__ */ new Map();
        }
        vs.set(valueKey, name);
        const s = this._scope[prefix] || (this._scope[prefix] = []);
        const itemIndex = s.length;
        s[itemIndex] = value.ref;
        name.setValue(value, { property: prefix, itemIndex });
        return name;
      }
      getValue(prefix, keyOrRef) {
        const vs = this._values[prefix];
        if (!vs)
          return;
        return vs.get(keyOrRef);
      }
      scopeRefs(scopeName, values = this._values) {
        return this._reduceValues(values, (name) => {
          if (name.scopePath === void 0)
            throw new Error(`CodeGen: name "${name}" has no value`);
          return (0, code_1._)`${scopeName}${name.scopePath}`;
        });
      }
      scopeCode(values = this._values, usedValues, getCode) {
        return this._reduceValues(values, (name) => {
          if (name.value === void 0)
            throw new Error(`CodeGen: name "${name}" has no value`);
          return name.value.code;
        }, usedValues, getCode);
      }
      _reduceValues(values, valueCode, usedValues = {}, getCode) {
        let code = code_1.nil;
        for (const prefix in values) {
          const vs = values[prefix];
          if (!vs)
            continue;
          const nameSet = usedValues[prefix] = usedValues[prefix] || /* @__PURE__ */ new Map();
          vs.forEach((name) => {
            if (nameSet.has(name))
              return;
            nameSet.set(name, UsedValueState.Started);
            let c = valueCode(name);
            if (c) {
              const def = this.opts.es5 ? exports.varKinds.var : exports.varKinds.const;
              code = (0, code_1._)`${code}${def} ${name} = ${c};${this.opts._n}`;
            } else if (c = getCode === null || getCode === void 0 ? void 0 : getCode(name)) {
              code = (0, code_1._)`${code}${c}${this.opts._n}`;
            } else {
              throw new ValueError(name);
            }
            nameSet.set(name, UsedValueState.Completed);
          });
        }
        return code;
      }
    };
    exports.ValueScope = ValueScope;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/codegen/index.js
var require_codegen = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/codegen/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.or = exports.and = exports.not = exports.CodeGen = exports.operators = exports.varKinds = exports.ValueScopeName = exports.ValueScope = exports.Scope = exports.Name = exports.regexpCode = exports.stringify = exports.getProperty = exports.nil = exports.strConcat = exports.str = exports._ = void 0;
    var code_1 = require_code();
    var scope_1 = require_scope();
    var code_2 = require_code();
    Object.defineProperty(exports, "_", { enumerable: true, get: function() {
      return code_2._;
    } });
    Object.defineProperty(exports, "str", { enumerable: true, get: function() {
      return code_2.str;
    } });
    Object.defineProperty(exports, "strConcat", { enumerable: true, get: function() {
      return code_2.strConcat;
    } });
    Object.defineProperty(exports, "nil", { enumerable: true, get: function() {
      return code_2.nil;
    } });
    Object.defineProperty(exports, "getProperty", { enumerable: true, get: function() {
      return code_2.getProperty;
    } });
    Object.defineProperty(exports, "stringify", { enumerable: true, get: function() {
      return code_2.stringify;
    } });
    Object.defineProperty(exports, "regexpCode", { enumerable: true, get: function() {
      return code_2.regexpCode;
    } });
    Object.defineProperty(exports, "Name", { enumerable: true, get: function() {
      return code_2.Name;
    } });
    var scope_2 = require_scope();
    Object.defineProperty(exports, "Scope", { enumerable: true, get: function() {
      return scope_2.Scope;
    } });
    Object.defineProperty(exports, "ValueScope", { enumerable: true, get: function() {
      return scope_2.ValueScope;
    } });
    Object.defineProperty(exports, "ValueScopeName", { enumerable: true, get: function() {
      return scope_2.ValueScopeName;
    } });
    Object.defineProperty(exports, "varKinds", { enumerable: true, get: function() {
      return scope_2.varKinds;
    } });
    exports.operators = {
      GT: new code_1._Code(">"),
      GTE: new code_1._Code(">="),
      LT: new code_1._Code("<"),
      LTE: new code_1._Code("<="),
      EQ: new code_1._Code("==="),
      NEQ: new code_1._Code("!=="),
      NOT: new code_1._Code("!"),
      OR: new code_1._Code("||"),
      AND: new code_1._Code("&&"),
      ADD: new code_1._Code("+")
    };
    var Node = class {
      optimizeNodes() {
        return this;
      }
      optimizeNames(_names, _constants) {
        return this;
      }
    };
    var Def = class extends Node {
      constructor(varKind, name, rhs) {
        super();
        this.varKind = varKind;
        this.name = name;
        this.rhs = rhs;
      }
      render({ es5, _n }) {
        const varKind = es5 ? scope_1.varKinds.var : this.varKind;
        const rhs = this.rhs === void 0 ? "" : ` = ${this.rhs}`;
        return `${varKind} ${this.name}${rhs};` + _n;
      }
      optimizeNames(names, constants2) {
        if (!names[this.name.str])
          return;
        if (this.rhs)
          this.rhs = optimizeExpr(this.rhs, names, constants2);
        return this;
      }
      get names() {
        return this.rhs instanceof code_1._CodeOrName ? this.rhs.names : {};
      }
    };
    var Assign = class extends Node {
      constructor(lhs, rhs, sideEffects) {
        super();
        this.lhs = lhs;
        this.rhs = rhs;
        this.sideEffects = sideEffects;
      }
      render({ _n }) {
        return `${this.lhs} = ${this.rhs};` + _n;
      }
      optimizeNames(names, constants2) {
        if (this.lhs instanceof code_1.Name && !names[this.lhs.str] && !this.sideEffects)
          return;
        this.rhs = optimizeExpr(this.rhs, names, constants2);
        return this;
      }
      get names() {
        const names = this.lhs instanceof code_1.Name ? {} : { ...this.lhs.names };
        return addExprNames(names, this.rhs);
      }
    };
    var AssignOp = class extends Assign {
      constructor(lhs, op, rhs, sideEffects) {
        super(lhs, rhs, sideEffects);
        this.op = op;
      }
      render({ _n }) {
        return `${this.lhs} ${this.op}= ${this.rhs};` + _n;
      }
    };
    var Label = class extends Node {
      constructor(label) {
        super();
        this.label = label;
        this.names = {};
      }
      render({ _n }) {
        return `${this.label}:` + _n;
      }
    };
    var Break = class extends Node {
      constructor(label) {
        super();
        this.label = label;
        this.names = {};
      }
      render({ _n }) {
        const label = this.label ? ` ${this.label}` : "";
        return `break${label};` + _n;
      }
    };
    var Throw2 = class extends Node {
      constructor(error) {
        super();
        this.error = error;
      }
      render({ _n }) {
        return `throw ${this.error};` + _n;
      }
      get names() {
        return this.error.names;
      }
    };
    var AnyCode = class extends Node {
      constructor(code) {
        super();
        this.code = code;
      }
      render({ _n }) {
        return `${this.code};` + _n;
      }
      optimizeNodes() {
        return `${this.code}` ? this : void 0;
      }
      optimizeNames(names, constants2) {
        this.code = optimizeExpr(this.code, names, constants2);
        return this;
      }
      get names() {
        return this.code instanceof code_1._CodeOrName ? this.code.names : {};
      }
    };
    var ParentNode = class extends Node {
      constructor(nodes = []) {
        super();
        this.nodes = nodes;
      }
      render(opts) {
        return this.nodes.reduce((code, n) => code + n.render(opts), "");
      }
      optimizeNodes() {
        const { nodes } = this;
        let i = nodes.length;
        while (i--) {
          const n = nodes[i].optimizeNodes();
          if (Array.isArray(n))
            nodes.splice(i, 1, ...n);
          else if (n)
            nodes[i] = n;
          else
            nodes.splice(i, 1);
        }
        return nodes.length > 0 ? this : void 0;
      }
      optimizeNames(names, constants2) {
        const { nodes } = this;
        let i = nodes.length;
        while (i--) {
          const n = nodes[i];
          if (n.optimizeNames(names, constants2))
            continue;
          subtractNames(names, n.names);
          nodes.splice(i, 1);
        }
        return nodes.length > 0 ? this : void 0;
      }
      get names() {
        return this.nodes.reduce((names, n) => addNames(names, n.names), {});
      }
    };
    var BlockNode = class extends ParentNode {
      render(opts) {
        return "{" + opts._n + super.render(opts) + "}" + opts._n;
      }
    };
    var Root = class extends ParentNode {
    };
    var Else = class extends BlockNode {
    };
    Else.kind = "else";
    var If = class _If extends BlockNode {
      constructor(condition, nodes) {
        super(nodes);
        this.condition = condition;
      }
      render(opts) {
        let code = `if(${this.condition})` + super.render(opts);
        if (this.else)
          code += "else " + this.else.render(opts);
        return code;
      }
      optimizeNodes() {
        super.optimizeNodes();
        const cond = this.condition;
        if (cond === true)
          return this.nodes;
        let e = this.else;
        if (e) {
          const ns = e.optimizeNodes();
          e = this.else = Array.isArray(ns) ? new Else(ns) : ns;
        }
        if (e) {
          if (cond === false)
            return e instanceof _If ? e : e.nodes;
          if (this.nodes.length)
            return this;
          return new _If(not(cond), e instanceof _If ? [e] : e.nodes);
        }
        if (cond === false || !this.nodes.length)
          return void 0;
        return this;
      }
      optimizeNames(names, constants2) {
        var _a;
        this.else = (_a = this.else) === null || _a === void 0 ? void 0 : _a.optimizeNames(names, constants2);
        if (!(super.optimizeNames(names, constants2) || this.else))
          return;
        this.condition = optimizeExpr(this.condition, names, constants2);
        return this;
      }
      get names() {
        const names = super.names;
        addExprNames(names, this.condition);
        if (this.else)
          addNames(names, this.else.names);
        return names;
      }
    };
    If.kind = "if";
    var For = class extends BlockNode {
    };
    For.kind = "for";
    var ForLoop = class extends For {
      constructor(iteration) {
        super();
        this.iteration = iteration;
      }
      render(opts) {
        return `for(${this.iteration})` + super.render(opts);
      }
      optimizeNames(names, constants2) {
        if (!super.optimizeNames(names, constants2))
          return;
        this.iteration = optimizeExpr(this.iteration, names, constants2);
        return this;
      }
      get names() {
        return addNames(super.names, this.iteration.names);
      }
    };
    var ForRange = class extends For {
      constructor(varKind, name, from, to) {
        super();
        this.varKind = varKind;
        this.name = name;
        this.from = from;
        this.to = to;
      }
      render(opts) {
        const varKind = opts.es5 ? scope_1.varKinds.var : this.varKind;
        const { name, from, to } = this;
        return `for(${varKind} ${name}=${from}; ${name}<${to}; ${name}++)` + super.render(opts);
      }
      get names() {
        const names = addExprNames(super.names, this.from);
        return addExprNames(names, this.to);
      }
    };
    var ForIter = class extends For {
      constructor(loop, varKind, name, iterable) {
        super();
        this.loop = loop;
        this.varKind = varKind;
        this.name = name;
        this.iterable = iterable;
      }
      render(opts) {
        return `for(${this.varKind} ${this.name} ${this.loop} ${this.iterable})` + super.render(opts);
      }
      optimizeNames(names, constants2) {
        if (!super.optimizeNames(names, constants2))
          return;
        this.iterable = optimizeExpr(this.iterable, names, constants2);
        return this;
      }
      get names() {
        return addNames(super.names, this.iterable.names);
      }
    };
    var Func = class extends BlockNode {
      constructor(name, args, async) {
        super();
        this.name = name;
        this.args = args;
        this.async = async;
      }
      render(opts) {
        const _async = this.async ? "async " : "";
        return `${_async}function ${this.name}(${this.args})` + super.render(opts);
      }
    };
    Func.kind = "func";
    var Return = class extends ParentNode {
      render(opts) {
        return "return " + super.render(opts);
      }
    };
    Return.kind = "return";
    var Try = class extends BlockNode {
      render(opts) {
        let code = "try" + super.render(opts);
        if (this.catch)
          code += this.catch.render(opts);
        if (this.finally)
          code += this.finally.render(opts);
        return code;
      }
      optimizeNodes() {
        var _a, _b;
        super.optimizeNodes();
        (_a = this.catch) === null || _a === void 0 ? void 0 : _a.optimizeNodes();
        (_b = this.finally) === null || _b === void 0 ? void 0 : _b.optimizeNodes();
        return this;
      }
      optimizeNames(names, constants2) {
        var _a, _b;
        super.optimizeNames(names, constants2);
        (_a = this.catch) === null || _a === void 0 ? void 0 : _a.optimizeNames(names, constants2);
        (_b = this.finally) === null || _b === void 0 ? void 0 : _b.optimizeNames(names, constants2);
        return this;
      }
      get names() {
        const names = super.names;
        if (this.catch)
          addNames(names, this.catch.names);
        if (this.finally)
          addNames(names, this.finally.names);
        return names;
      }
    };
    var Catch = class extends BlockNode {
      constructor(error) {
        super();
        this.error = error;
      }
      render(opts) {
        return `catch(${this.error})` + super.render(opts);
      }
    };
    Catch.kind = "catch";
    var Finally = class extends BlockNode {
      render(opts) {
        return "finally" + super.render(opts);
      }
    };
    Finally.kind = "finally";
    var CodeGen = class {
      constructor(extScope, opts = {}) {
        this._values = {};
        this._blockStarts = [];
        this._constants = {};
        this.opts = { ...opts, _n: opts.lines ? "\n" : "" };
        this._extScope = extScope;
        this._scope = new scope_1.Scope({ parent: extScope });
        this._nodes = [new Root()];
      }
      toString() {
        return this._root.render(this.opts);
      }
      // returns unique name in the internal scope
      name(prefix) {
        return this._scope.name(prefix);
      }
      // reserves unique name in the external scope
      scopeName(prefix) {
        return this._extScope.name(prefix);
      }
      // reserves unique name in the external scope and assigns value to it
      scopeValue(prefixOrName, value) {
        const name = this._extScope.value(prefixOrName, value);
        const vs = this._values[name.prefix] || (this._values[name.prefix] = /* @__PURE__ */ new Set());
        vs.add(name);
        return name;
      }
      getScopeValue(prefix, keyOrRef) {
        return this._extScope.getValue(prefix, keyOrRef);
      }
      // return code that assigns values in the external scope to the names that are used internally
      // (same names that were returned by gen.scopeName or gen.scopeValue)
      scopeRefs(scopeName) {
        return this._extScope.scopeRefs(scopeName, this._values);
      }
      scopeCode() {
        return this._extScope.scopeCode(this._values);
      }
      _def(varKind, nameOrPrefix, rhs, constant) {
        const name = this._scope.toName(nameOrPrefix);
        if (rhs !== void 0 && constant)
          this._constants[name.str] = rhs;
        this._leafNode(new Def(varKind, name, rhs));
        return name;
      }
      // `const` declaration (`var` in es5 mode)
      const(nameOrPrefix, rhs, _constant) {
        return this._def(scope_1.varKinds.const, nameOrPrefix, rhs, _constant);
      }
      // `let` declaration with optional assignment (`var` in es5 mode)
      let(nameOrPrefix, rhs, _constant) {
        return this._def(scope_1.varKinds.let, nameOrPrefix, rhs, _constant);
      }
      // `var` declaration with optional assignment
      var(nameOrPrefix, rhs, _constant) {
        return this._def(scope_1.varKinds.var, nameOrPrefix, rhs, _constant);
      }
      // assignment code
      assign(lhs, rhs, sideEffects) {
        return this._leafNode(new Assign(lhs, rhs, sideEffects));
      }
      // `+=` code
      add(lhs, rhs) {
        return this._leafNode(new AssignOp(lhs, exports.operators.ADD, rhs));
      }
      // appends passed SafeExpr to code or executes Block
      code(c) {
        if (typeof c == "function")
          c();
        else if (c !== code_1.nil)
          this._leafNode(new AnyCode(c));
        return this;
      }
      // returns code for object literal for the passed argument list of key-value pairs
      object(...keyValues) {
        const code = ["{"];
        for (const [key, value] of keyValues) {
          if (code.length > 1)
            code.push(",");
          code.push(key);
          if (key !== value || this.opts.es5) {
            code.push(":");
            (0, code_1.addCodeArg)(code, value);
          }
        }
        code.push("}");
        return new code_1._Code(code);
      }
      // `if` clause (or statement if `thenBody` and, optionally, `elseBody` are passed)
      if(condition, thenBody, elseBody) {
        this._blockNode(new If(condition));
        if (thenBody && elseBody) {
          this.code(thenBody).else().code(elseBody).endIf();
        } else if (thenBody) {
          this.code(thenBody).endIf();
        } else if (elseBody) {
          throw new Error('CodeGen: "else" body without "then" body');
        }
        return this;
      }
      // `else if` clause - invalid without `if` or after `else` clauses
      elseIf(condition) {
        return this._elseNode(new If(condition));
      }
      // `else` clause - only valid after `if` or `else if` clauses
      else() {
        return this._elseNode(new Else());
      }
      // end `if` statement (needed if gen.if was used only with condition)
      endIf() {
        return this._endBlockNode(If, Else);
      }
      _for(node, forBody) {
        this._blockNode(node);
        if (forBody)
          this.code(forBody).endFor();
        return this;
      }
      // a generic `for` clause (or statement if `forBody` is passed)
      for(iteration, forBody) {
        return this._for(new ForLoop(iteration), forBody);
      }
      // `for` statement for a range of values
      forRange(nameOrPrefix, from, to, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.let) {
        const name = this._scope.toName(nameOrPrefix);
        return this._for(new ForRange(varKind, name, from, to), () => forBody(name));
      }
      // `for-of` statement (in es5 mode replace with a normal for loop)
      forOf(nameOrPrefix, iterable, forBody, varKind = scope_1.varKinds.const) {
        const name = this._scope.toName(nameOrPrefix);
        if (this.opts.es5) {
          const arr = iterable instanceof code_1.Name ? iterable : this.var("_arr", iterable);
          return this.forRange("_i", 0, (0, code_1._)`${arr}.length`, (i) => {
            this.var(name, (0, code_1._)`${arr}[${i}]`);
            forBody(name);
          });
        }
        return this._for(new ForIter("of", varKind, name, iterable), () => forBody(name));
      }
      // `for-in` statement.
      // With option `ownProperties` replaced with a `for-of` loop for object keys
      forIn(nameOrPrefix, obj, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.const) {
        if (this.opts.ownProperties) {
          return this.forOf(nameOrPrefix, (0, code_1._)`Object.keys(${obj})`, forBody);
        }
        const name = this._scope.toName(nameOrPrefix);
        return this._for(new ForIter("in", varKind, name, obj), () => forBody(name));
      }
      // end `for` loop
      endFor() {
        return this._endBlockNode(For);
      }
      // `label` statement
      label(label) {
        return this._leafNode(new Label(label));
      }
      // `break` statement
      break(label) {
        return this._leafNode(new Break(label));
      }
      // `return` statement
      return(value) {
        const node = new Return();
        this._blockNode(node);
        this.code(value);
        if (node.nodes.length !== 1)
          throw new Error('CodeGen: "return" should have one node');
        return this._endBlockNode(Return);
      }
      // `try` statement
      try(tryBody, catchCode, finallyCode) {
        if (!catchCode && !finallyCode)
          throw new Error('CodeGen: "try" without "catch" and "finally"');
        const node = new Try();
        this._blockNode(node);
        this.code(tryBody);
        if (catchCode) {
          const error = this.name("e");
          this._currNode = node.catch = new Catch(error);
          catchCode(error);
        }
        if (finallyCode) {
          this._currNode = node.finally = new Finally();
          this.code(finallyCode);
        }
        return this._endBlockNode(Catch, Finally);
      }
      // `throw` statement
      throw(error) {
        return this._leafNode(new Throw2(error));
      }
      // start self-balancing block
      block(body, nodeCount) {
        this._blockStarts.push(this._nodes.length);
        if (body)
          this.code(body).endBlock(nodeCount);
        return this;
      }
      // end the current self-balancing block
      endBlock(nodeCount) {
        const len = this._blockStarts.pop();
        if (len === void 0)
          throw new Error("CodeGen: not in self-balancing block");
        const toClose = this._nodes.length - len;
        if (toClose < 0 || nodeCount !== void 0 && toClose !== nodeCount) {
          throw new Error(`CodeGen: wrong number of nodes: ${toClose} vs ${nodeCount} expected`);
        }
        this._nodes.length = len;
        return this;
      }
      // `function` heading (or definition if funcBody is passed)
      func(name, args = code_1.nil, async, funcBody) {
        this._blockNode(new Func(name, args, async));
        if (funcBody)
          this.code(funcBody).endFunc();
        return this;
      }
      // end function definition
      endFunc() {
        return this._endBlockNode(Func);
      }
      optimize(n = 1) {
        while (n-- > 0) {
          this._root.optimizeNodes();
          this._root.optimizeNames(this._root.names, this._constants);
        }
      }
      _leafNode(node) {
        this._currNode.nodes.push(node);
        return this;
      }
      _blockNode(node) {
        this._currNode.nodes.push(node);
        this._nodes.push(node);
      }
      _endBlockNode(N1, N2) {
        const n = this._currNode;
        if (n instanceof N1 || N2 && n instanceof N2) {
          this._nodes.pop();
          return this;
        }
        throw new Error(`CodeGen: not in block "${N2 ? `${N1.kind}/${N2.kind}` : N1.kind}"`);
      }
      _elseNode(node) {
        const n = this._currNode;
        if (!(n instanceof If)) {
          throw new Error('CodeGen: "else" without "if"');
        }
        this._currNode = n.else = node;
        return this;
      }
      get _root() {
        return this._nodes[0];
      }
      get _currNode() {
        const ns = this._nodes;
        return ns[ns.length - 1];
      }
      set _currNode(node) {
        const ns = this._nodes;
        ns[ns.length - 1] = node;
      }
    };
    exports.CodeGen = CodeGen;
    function addNames(names, from) {
      for (const n in from)
        names[n] = (names[n] || 0) + (from[n] || 0);
      return names;
    }
    function addExprNames(names, from) {
      return from instanceof code_1._CodeOrName ? addNames(names, from.names) : names;
    }
    function optimizeExpr(expr, names, constants2) {
      if (expr instanceof code_1.Name)
        return replaceName(expr);
      if (!canOptimize(expr))
        return expr;
      return new code_1._Code(expr._items.reduce((items, c) => {
        if (c instanceof code_1.Name)
          c = replaceName(c);
        if (c instanceof code_1._Code)
          items.push(...c._items);
        else
          items.push(c);
        return items;
      }, []));
      function replaceName(n) {
        const c = constants2[n.str];
        if (c === void 0 || names[n.str] !== 1)
          return n;
        delete names[n.str];
        return c;
      }
      function canOptimize(e) {
        return e instanceof code_1._Code && e._items.some((c) => c instanceof code_1.Name && names[c.str] === 1 && constants2[c.str] !== void 0);
      }
    }
    function subtractNames(names, from) {
      for (const n in from)
        names[n] = (names[n] || 0) - (from[n] || 0);
    }
    function not(x) {
      return typeof x == "boolean" || typeof x == "number" || x === null ? !x : (0, code_1._)`!${par(x)}`;
    }
    exports.not = not;
    var andCode = mappend(exports.operators.AND);
    function and(...args) {
      return args.reduce(andCode);
    }
    exports.and = and;
    var orCode = mappend(exports.operators.OR);
    function or(...args) {
      return args.reduce(orCode);
    }
    exports.or = or;
    function mappend(op) {
      return (x, y) => x === code_1.nil ? y : y === code_1.nil ? x : (0, code_1._)`${par(x)} ${op} ${par(y)}`;
    }
    function par(x) {
      return x instanceof code_1.Name ? x : (0, code_1._)`(${x})`;
    }
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/util.js
var require_util = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/util.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.checkStrictMode = exports.getErrorPath = exports.Type = exports.useFunc = exports.setEvaluated = exports.evaluatedPropsToName = exports.mergeEvaluated = exports.eachItem = exports.unescapeJsonPointer = exports.escapeJsonPointer = exports.escapeFragment = exports.unescapeFragment = exports.schemaRefOrVal = exports.schemaHasRulesButRef = exports.schemaHasRules = exports.checkUnknownRules = exports.alwaysValidSchema = exports.toHash = void 0;
    var codegen_1 = require_codegen();
    var code_1 = require_code();
    function toHash(arr) {
      const hash3 = {};
      for (const item of arr)
        hash3[item] = true;
      return hash3;
    }
    exports.toHash = toHash;
    function alwaysValidSchema(it, schema) {
      if (typeof schema == "boolean")
        return schema;
      if (Object.keys(schema).length === 0)
        return true;
      checkUnknownRules(it, schema);
      return !schemaHasRules(schema, it.self.RULES.all);
    }
    exports.alwaysValidSchema = alwaysValidSchema;
    function checkUnknownRules(it, schema = it.schema) {
      const { opts, self } = it;
      if (!opts.strictSchema)
        return;
      if (typeof schema === "boolean")
        return;
      const rules = self.RULES.keywords;
      for (const key in schema) {
        if (!rules[key])
          checkStrictMode(it, `unknown keyword: "${key}"`);
      }
    }
    exports.checkUnknownRules = checkUnknownRules;
    function schemaHasRules(schema, rules) {
      if (typeof schema == "boolean")
        return !schema;
      for (const key in schema)
        if (rules[key])
          return true;
      return false;
    }
    exports.schemaHasRules = schemaHasRules;
    function schemaHasRulesButRef(schema, RULES) {
      if (typeof schema == "boolean")
        return !schema;
      for (const key in schema)
        if (key !== "$ref" && RULES.all[key])
          return true;
      return false;
    }
    exports.schemaHasRulesButRef = schemaHasRulesButRef;
    function schemaRefOrVal({ topSchemaRef, schemaPath }, schema, keyword, $data) {
      if (!$data) {
        if (typeof schema == "number" || typeof schema == "boolean")
          return schema;
        if (typeof schema == "string")
          return (0, codegen_1._)`${schema}`;
      }
      return (0, codegen_1._)`${topSchemaRef}${schemaPath}${(0, codegen_1.getProperty)(keyword)}`;
    }
    exports.schemaRefOrVal = schemaRefOrVal;
    function unescapeFragment(str) {
      return unescapeJsonPointer(decodeURIComponent(str));
    }
    exports.unescapeFragment = unescapeFragment;
    function escapeFragment(str) {
      return encodeURIComponent(escapeJsonPointer(str));
    }
    exports.escapeFragment = escapeFragment;
    function escapeJsonPointer(str) {
      if (typeof str == "number")
        return `${str}`;
      return str.replace(/~/g, "~0").replace(/\//g, "~1");
    }
    exports.escapeJsonPointer = escapeJsonPointer;
    function unescapeJsonPointer(str) {
      return str.replace(/~1/g, "/").replace(/~0/g, "~");
    }
    exports.unescapeJsonPointer = unescapeJsonPointer;
    function eachItem(xs, f) {
      if (Array.isArray(xs)) {
        for (const x of xs)
          f(x);
      } else {
        f(xs);
      }
    }
    exports.eachItem = eachItem;
    function makeMergeEvaluated({ mergeNames, mergeToName, mergeValues, resultToName }) {
      return (gen, from, to, toName) => {
        const res = to === void 0 ? from : to instanceof codegen_1.Name ? (from instanceof codegen_1.Name ? mergeNames(gen, from, to) : mergeToName(gen, from, to), to) : from instanceof codegen_1.Name ? (mergeToName(gen, to, from), from) : mergeValues(from, to);
        return toName === codegen_1.Name && !(res instanceof codegen_1.Name) ? resultToName(gen, res) : res;
      };
    }
    exports.mergeEvaluated = {
      props: makeMergeEvaluated({
        mergeNames: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true && ${from} !== undefined`, () => {
          gen.if((0, codegen_1._)`${from} === true`, () => gen.assign(to, true), () => gen.assign(to, (0, codegen_1._)`${to} || {}`).code((0, codegen_1._)`Object.assign(${to}, ${from})`));
        }),
        mergeToName: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true`, () => {
          if (from === true) {
            gen.assign(to, true);
          } else {
            gen.assign(to, (0, codegen_1._)`${to} || {}`);
            setEvaluated(gen, to, from);
          }
        }),
        mergeValues: (from, to) => from === true ? true : { ...from, ...to },
        resultToName: evaluatedPropsToName
      }),
      items: makeMergeEvaluated({
        mergeNames: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true && ${from} !== undefined`, () => gen.assign(to, (0, codegen_1._)`${from} === true ? true : ${to} > ${from} ? ${to} : ${from}`)),
        mergeToName: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true`, () => gen.assign(to, from === true ? true : (0, codegen_1._)`${to} > ${from} ? ${to} : ${from}`)),
        mergeValues: (from, to) => from === true ? true : Math.max(from, to),
        resultToName: (gen, items) => gen.var("items", items)
      })
    };
    function evaluatedPropsToName(gen, ps) {
      if (ps === true)
        return gen.var("props", true);
      const props = gen.var("props", (0, codegen_1._)`{}`);
      if (ps !== void 0)
        setEvaluated(gen, props, ps);
      return props;
    }
    exports.evaluatedPropsToName = evaluatedPropsToName;
    function setEvaluated(gen, props, ps) {
      Object.keys(ps).forEach((p) => gen.assign((0, codegen_1._)`${props}${(0, codegen_1.getProperty)(p)}`, true));
    }
    exports.setEvaluated = setEvaluated;
    var snippets = {};
    function useFunc(gen, f) {
      return gen.scopeValue("func", {
        ref: f,
        code: snippets[f.code] || (snippets[f.code] = new code_1._Code(f.code))
      });
    }
    exports.useFunc = useFunc;
    var Type2;
    (function(Type3) {
      Type3[Type3["Num"] = 0] = "Num";
      Type3[Type3["Str"] = 1] = "Str";
    })(Type2 || (exports.Type = Type2 = {}));
    function getErrorPath(dataProp, dataPropType, jsPropertySyntax) {
      if (dataProp instanceof codegen_1.Name) {
        const isNumber = dataPropType === Type2.Num;
        return jsPropertySyntax ? isNumber ? (0, codegen_1._)`"[" + ${dataProp} + "]"` : (0, codegen_1._)`"['" + ${dataProp} + "']"` : isNumber ? (0, codegen_1._)`"/" + ${dataProp}` : (0, codegen_1._)`"/" + ${dataProp}.replace(/~/g, "~0").replace(/\\//g, "~1")`;
      }
      return jsPropertySyntax ? (0, codegen_1.getProperty)(dataProp).toString() : "/" + escapeJsonPointer(dataProp);
    }
    exports.getErrorPath = getErrorPath;
    function checkStrictMode(it, msg, mode = it.opts.strictSchema) {
      if (!mode)
        return;
      msg = `strict mode: ${msg}`;
      if (mode === true)
        throw new Error(msg);
      it.self.logger.warn(msg);
    }
    exports.checkStrictMode = checkStrictMode;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/names.js
var require_names = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/names.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var names = {
      // validation function arguments
      data: new codegen_1.Name("data"),
      // data passed to validation function
      // args passed from referencing schema
      valCxt: new codegen_1.Name("valCxt"),
      // validation/data context - should not be used directly, it is destructured to the names below
      instancePath: new codegen_1.Name("instancePath"),
      parentData: new codegen_1.Name("parentData"),
      parentDataProperty: new codegen_1.Name("parentDataProperty"),
      rootData: new codegen_1.Name("rootData"),
      // root data - same as the data passed to the first/top validation function
      dynamicAnchors: new codegen_1.Name("dynamicAnchors"),
      // used to support recursiveRef and dynamicRef
      // function scoped variables
      vErrors: new codegen_1.Name("vErrors"),
      // null or array of validation errors
      errors: new codegen_1.Name("errors"),
      // counter of validation errors
      this: new codegen_1.Name("this"),
      // "globals"
      self: new codegen_1.Name("self"),
      scope: new codegen_1.Name("scope"),
      // JTD serialize/parse name for JSON string and position
      json: new codegen_1.Name("json"),
      jsonPos: new codegen_1.Name("jsonPos"),
      jsonLen: new codegen_1.Name("jsonLen"),
      jsonPart: new codegen_1.Name("jsonPart")
    };
    exports.default = names;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/errors.js
var require_errors = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/errors.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.extendErrors = exports.resetErrorsCount = exports.reportExtraError = exports.reportError = exports.keyword$DataError = exports.keywordError = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var names_1 = require_names();
    exports.keywordError = {
      message: ({ keyword }) => (0, codegen_1.str)`must pass "${keyword}" keyword validation`
    };
    exports.keyword$DataError = {
      message: ({ keyword, schemaType }) => schemaType ? (0, codegen_1.str)`"${keyword}" keyword must be ${schemaType} ($data)` : (0, codegen_1.str)`"${keyword}" keyword is invalid ($data)`
    };
    function reportError(cxt, error = exports.keywordError, errorPaths, overrideAllErrors) {
      const { it } = cxt;
      const { gen, compositeRule, allErrors } = it;
      const errObj = errorObjectCode(cxt, error, errorPaths);
      if (overrideAllErrors !== null && overrideAllErrors !== void 0 ? overrideAllErrors : compositeRule || allErrors) {
        addError(gen, errObj);
      } else {
        returnErrors(it, (0, codegen_1._)`[${errObj}]`);
      }
    }
    exports.reportError = reportError;
    function reportExtraError(cxt, error = exports.keywordError, errorPaths) {
      const { it } = cxt;
      const { gen, compositeRule, allErrors } = it;
      const errObj = errorObjectCode(cxt, error, errorPaths);
      addError(gen, errObj);
      if (!(compositeRule || allErrors)) {
        returnErrors(it, names_1.default.vErrors);
      }
    }
    exports.reportExtraError = reportExtraError;
    function resetErrorsCount(gen, errsCount) {
      gen.assign(names_1.default.errors, errsCount);
      gen.if((0, codegen_1._)`${names_1.default.vErrors} !== null`, () => gen.if(errsCount, () => gen.assign((0, codegen_1._)`${names_1.default.vErrors}.length`, errsCount), () => gen.assign(names_1.default.vErrors, null)));
    }
    exports.resetErrorsCount = resetErrorsCount;
    function extendErrors({ gen, keyword, schemaValue, data, errsCount, it }) {
      if (errsCount === void 0)
        throw new Error("ajv implementation error");
      const err = gen.name("err");
      gen.forRange("i", errsCount, names_1.default.errors, (i) => {
        gen.const(err, (0, codegen_1._)`${names_1.default.vErrors}[${i}]`);
        gen.if((0, codegen_1._)`${err}.instancePath === undefined`, () => gen.assign((0, codegen_1._)`${err}.instancePath`, (0, codegen_1.strConcat)(names_1.default.instancePath, it.errorPath)));
        gen.assign((0, codegen_1._)`${err}.schemaPath`, (0, codegen_1.str)`${it.errSchemaPath}/${keyword}`);
        if (it.opts.verbose) {
          gen.assign((0, codegen_1._)`${err}.schema`, schemaValue);
          gen.assign((0, codegen_1._)`${err}.data`, data);
        }
      });
    }
    exports.extendErrors = extendErrors;
    function addError(gen, errObj) {
      const err = gen.const("err", errObj);
      gen.if((0, codegen_1._)`${names_1.default.vErrors} === null`, () => gen.assign(names_1.default.vErrors, (0, codegen_1._)`[${err}]`), (0, codegen_1._)`${names_1.default.vErrors}.push(${err})`);
      gen.code((0, codegen_1._)`${names_1.default.errors}++`);
    }
    function returnErrors(it, errs) {
      const { gen, validateName, schemaEnv } = it;
      if (schemaEnv.$async) {
        gen.throw((0, codegen_1._)`new ${it.ValidationError}(${errs})`);
      } else {
        gen.assign((0, codegen_1._)`${validateName}.errors`, errs);
        gen.return(false);
      }
    }
    var E = {
      keyword: new codegen_1.Name("keyword"),
      schemaPath: new codegen_1.Name("schemaPath"),
      // also used in JTD errors
      params: new codegen_1.Name("params"),
      propertyName: new codegen_1.Name("propertyName"),
      message: new codegen_1.Name("message"),
      schema: new codegen_1.Name("schema"),
      parentSchema: new codegen_1.Name("parentSchema")
    };
    function errorObjectCode(cxt, error, errorPaths) {
      const { createErrors } = cxt.it;
      if (createErrors === false)
        return (0, codegen_1._)`{}`;
      return errorObject(cxt, error, errorPaths);
    }
    function errorObject(cxt, error, errorPaths = {}) {
      const { gen, it } = cxt;
      const keyValues = [
        errorInstancePath(it, errorPaths),
        errorSchemaPath(cxt, errorPaths)
      ];
      extraErrorProps(cxt, error, keyValues);
      return gen.object(...keyValues);
    }
    function errorInstancePath({ errorPath }, { instancePath }) {
      const instPath = instancePath ? (0, codegen_1.str)`${errorPath}${(0, util_1.getErrorPath)(instancePath, util_1.Type.Str)}` : errorPath;
      return [names_1.default.instancePath, (0, codegen_1.strConcat)(names_1.default.instancePath, instPath)];
    }
    function errorSchemaPath({ keyword, it: { errSchemaPath } }, { schemaPath, parentSchema }) {
      let schPath = parentSchema ? errSchemaPath : (0, codegen_1.str)`${errSchemaPath}/${keyword}`;
      if (schemaPath) {
        schPath = (0, codegen_1.str)`${schPath}${(0, util_1.getErrorPath)(schemaPath, util_1.Type.Str)}`;
      }
      return [E.schemaPath, schPath];
    }
    function extraErrorProps(cxt, { params, message }, keyValues) {
      const { keyword, data, schemaValue, it } = cxt;
      const { opts, propertyName, topSchemaRef, schemaPath } = it;
      keyValues.push([E.keyword, keyword], [E.params, typeof params == "function" ? params(cxt) : params || (0, codegen_1._)`{}`]);
      if (opts.messages) {
        keyValues.push([E.message, typeof message == "function" ? message(cxt) : message]);
      }
      if (opts.verbose) {
        keyValues.push([E.schema, schemaValue], [E.parentSchema, (0, codegen_1._)`${topSchemaRef}${schemaPath}`], [names_1.default.data, data]);
      }
      if (propertyName)
        keyValues.push([E.propertyName, propertyName]);
    }
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/validate/boolSchema.js
var require_boolSchema = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/validate/boolSchema.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.boolOrEmptySchema = exports.topBoolOrEmptySchema = void 0;
    var errors_1 = require_errors();
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var boolError = {
      message: "boolean schema is false"
    };
    function topBoolOrEmptySchema(it) {
      const { gen, schema, validateName } = it;
      if (schema === false) {
        falseSchemaError(it, false);
      } else if (typeof schema == "object" && schema.$async === true) {
        gen.return(names_1.default.data);
      } else {
        gen.assign((0, codegen_1._)`${validateName}.errors`, null);
        gen.return(true);
      }
    }
    exports.topBoolOrEmptySchema = topBoolOrEmptySchema;
    function boolOrEmptySchema(it, valid) {
      const { gen, schema } = it;
      if (schema === false) {
        gen.var(valid, false);
        falseSchemaError(it);
      } else {
        gen.var(valid, true);
      }
    }
    exports.boolOrEmptySchema = boolOrEmptySchema;
    function falseSchemaError(it, overrideAllErrors) {
      const { gen, data } = it;
      const cxt = {
        gen,
        keyword: "false schema",
        data,
        schema: false,
        schemaCode: false,
        schemaValue: false,
        params: {},
        it
      };
      (0, errors_1.reportError)(cxt, boolError, void 0, overrideAllErrors);
    }
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/rules.js
var require_rules = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/rules.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getRules = exports.isJSONType = void 0;
    var _jsonTypes = ["string", "number", "integer", "boolean", "null", "object", "array"];
    var jsonTypes = new Set(_jsonTypes);
    function isJSONType(x) {
      return typeof x == "string" && jsonTypes.has(x);
    }
    exports.isJSONType = isJSONType;
    function getRules() {
      const groups = {
        number: { type: "number", rules: [] },
        string: { type: "string", rules: [] },
        array: { type: "array", rules: [] },
        object: { type: "object", rules: [] }
      };
      return {
        types: { ...groups, integer: true, boolean: true, null: true },
        rules: [{ rules: [] }, groups.number, groups.string, groups.array, groups.object],
        post: { rules: [] },
        all: {},
        keywords: {}
      };
    }
    exports.getRules = getRules;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/validate/applicability.js
var require_applicability = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/validate/applicability.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.shouldUseRule = exports.shouldUseGroup = exports.schemaHasRulesForType = void 0;
    function schemaHasRulesForType({ schema, self }, type) {
      const group = self.RULES.types[type];
      return group && group !== true && shouldUseGroup(schema, group);
    }
    exports.schemaHasRulesForType = schemaHasRulesForType;
    function shouldUseGroup(schema, group) {
      return group.rules.some((rule) => shouldUseRule(schema, rule));
    }
    exports.shouldUseGroup = shouldUseGroup;
    function shouldUseRule(schema, rule) {
      var _a;
      return schema[rule.keyword] !== void 0 || ((_a = rule.definition.implements) === null || _a === void 0 ? void 0 : _a.some((kwd) => schema[kwd] !== void 0));
    }
    exports.shouldUseRule = shouldUseRule;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/validate/dataType.js
var require_dataType = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/validate/dataType.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.reportTypeError = exports.checkDataTypes = exports.checkDataType = exports.coerceAndCheckDataType = exports.getJSONTypes = exports.getSchemaTypes = exports.DataType = void 0;
    var rules_1 = require_rules();
    var applicability_1 = require_applicability();
    var errors_1 = require_errors();
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var DataType;
    (function(DataType2) {
      DataType2[DataType2["Correct"] = 0] = "Correct";
      DataType2[DataType2["Wrong"] = 1] = "Wrong";
    })(DataType || (exports.DataType = DataType = {}));
    function getSchemaTypes(schema) {
      const types = getJSONTypes(schema.type);
      const hasNull = types.includes("null");
      if (hasNull) {
        if (schema.nullable === false)
          throw new Error("type: null contradicts nullable: false");
      } else {
        if (!types.length && schema.nullable !== void 0) {
          throw new Error('"nullable" cannot be used without "type"');
        }
        if (schema.nullable === true)
          types.push("null");
      }
      return types;
    }
    exports.getSchemaTypes = getSchemaTypes;
    function getJSONTypes(ts) {
      const types = Array.isArray(ts) ? ts : ts ? [ts] : [];
      if (types.every(rules_1.isJSONType))
        return types;
      throw new Error("type must be JSONType or JSONType[]: " + types.join(","));
    }
    exports.getJSONTypes = getJSONTypes;
    function coerceAndCheckDataType(it, types) {
      const { gen, data, opts } = it;
      const coerceTo = coerceToTypes(types, opts.coerceTypes);
      const checkTypes = types.length > 0 && !(coerceTo.length === 0 && types.length === 1 && (0, applicability_1.schemaHasRulesForType)(it, types[0]));
      if (checkTypes) {
        const wrongType = checkDataTypes(types, data, opts.strictNumbers, DataType.Wrong);
        gen.if(wrongType, () => {
          if (coerceTo.length)
            coerceData(it, types, coerceTo);
          else
            reportTypeError(it);
        });
      }
      return checkTypes;
    }
    exports.coerceAndCheckDataType = coerceAndCheckDataType;
    var COERCIBLE = /* @__PURE__ */ new Set(["string", "number", "integer", "boolean", "null"]);
    function coerceToTypes(types, coerceTypes) {
      return coerceTypes ? types.filter((t) => COERCIBLE.has(t) || coerceTypes === "array" && t === "array") : [];
    }
    function coerceData(it, types, coerceTo) {
      const { gen, data, opts } = it;
      const dataType = gen.let("dataType", (0, codegen_1._)`typeof ${data}`);
      const coerced = gen.let("coerced", (0, codegen_1._)`undefined`);
      if (opts.coerceTypes === "array") {
        gen.if((0, codegen_1._)`${dataType} == 'object' && Array.isArray(${data}) && ${data}.length == 1`, () => gen.assign(data, (0, codegen_1._)`${data}[0]`).assign(dataType, (0, codegen_1._)`typeof ${data}`).if(checkDataTypes(types, data, opts.strictNumbers), () => gen.assign(coerced, data)));
      }
      gen.if((0, codegen_1._)`${coerced} !== undefined`);
      for (const t of coerceTo) {
        if (COERCIBLE.has(t) || t === "array" && opts.coerceTypes === "array") {
          coerceSpecificType(t);
        }
      }
      gen.else();
      reportTypeError(it);
      gen.endIf();
      gen.if((0, codegen_1._)`${coerced} !== undefined`, () => {
        gen.assign(data, coerced);
        assignParentData(it, coerced);
      });
      function coerceSpecificType(t) {
        switch (t) {
          case "string":
            gen.elseIf((0, codegen_1._)`${dataType} == "number" || ${dataType} == "boolean"`).assign(coerced, (0, codegen_1._)`"" + ${data}`).elseIf((0, codegen_1._)`${data} === null`).assign(coerced, (0, codegen_1._)`""`);
            return;
          case "number":
            gen.elseIf((0, codegen_1._)`${dataType} == "boolean" || ${data} === null
              || (${dataType} == "string" && ${data} && ${data} == +${data})`).assign(coerced, (0, codegen_1._)`+${data}`);
            return;
          case "integer":
            gen.elseIf((0, codegen_1._)`${dataType} === "boolean" || ${data} === null
              || (${dataType} === "string" && ${data} && ${data} == +${data} && !(${data} % 1))`).assign(coerced, (0, codegen_1._)`+${data}`);
            return;
          case "boolean":
            gen.elseIf((0, codegen_1._)`${data} === "false" || ${data} === 0 || ${data} === null`).assign(coerced, false).elseIf((0, codegen_1._)`${data} === "true" || ${data} === 1`).assign(coerced, true);
            return;
          case "null":
            gen.elseIf((0, codegen_1._)`${data} === "" || ${data} === 0 || ${data} === false`);
            gen.assign(coerced, null);
            return;
          case "array":
            gen.elseIf((0, codegen_1._)`${dataType} === "string" || ${dataType} === "number"
              || ${dataType} === "boolean" || ${data} === null`).assign(coerced, (0, codegen_1._)`[${data}]`);
        }
      }
    }
    function assignParentData({ gen, parentData, parentDataProperty }, expr) {
      gen.if((0, codegen_1._)`${parentData} !== undefined`, () => gen.assign((0, codegen_1._)`${parentData}[${parentDataProperty}]`, expr));
    }
    function checkDataType(dataType, data, strictNums, correct = DataType.Correct) {
      const EQ = correct === DataType.Correct ? codegen_1.operators.EQ : codegen_1.operators.NEQ;
      let cond;
      switch (dataType) {
        case "null":
          return (0, codegen_1._)`${data} ${EQ} null`;
        case "array":
          cond = (0, codegen_1._)`Array.isArray(${data})`;
          break;
        case "object":
          cond = (0, codegen_1._)`${data} && typeof ${data} == "object" && !Array.isArray(${data})`;
          break;
        case "integer":
          cond = numCond((0, codegen_1._)`!(${data} % 1) && !isNaN(${data})`);
          break;
        case "number":
          cond = numCond();
          break;
        default:
          return (0, codegen_1._)`typeof ${data} ${EQ} ${dataType}`;
      }
      return correct === DataType.Correct ? cond : (0, codegen_1.not)(cond);
      function numCond(_cond = codegen_1.nil) {
        return (0, codegen_1.and)((0, codegen_1._)`typeof ${data} == "number"`, _cond, strictNums ? (0, codegen_1._)`isFinite(${data})` : codegen_1.nil);
      }
    }
    exports.checkDataType = checkDataType;
    function checkDataTypes(dataTypes, data, strictNums, correct) {
      if (dataTypes.length === 1) {
        return checkDataType(dataTypes[0], data, strictNums, correct);
      }
      let cond;
      const types = (0, util_1.toHash)(dataTypes);
      if (types.array && types.object) {
        const notObj = (0, codegen_1._)`typeof ${data} != "object"`;
        cond = types.null ? notObj : (0, codegen_1._)`!${data} || ${notObj}`;
        delete types.null;
        delete types.array;
        delete types.object;
      } else {
        cond = codegen_1.nil;
      }
      if (types.number)
        delete types.integer;
      for (const t in types)
        cond = (0, codegen_1.and)(cond, checkDataType(t, data, strictNums, correct));
      return cond;
    }
    exports.checkDataTypes = checkDataTypes;
    var typeError = {
      message: ({ schema }) => `must be ${schema}`,
      params: ({ schema, schemaValue }) => typeof schema == "string" ? (0, codegen_1._)`{type: ${schema}}` : (0, codegen_1._)`{type: ${schemaValue}}`
    };
    function reportTypeError(it) {
      const cxt = getTypeErrorContext(it);
      (0, errors_1.reportError)(cxt, typeError);
    }
    exports.reportTypeError = reportTypeError;
    function getTypeErrorContext(it) {
      const { gen, data, schema } = it;
      const schemaCode = (0, util_1.schemaRefOrVal)(it, schema, "type");
      return {
        gen,
        keyword: "type",
        data,
        schema: schema.type,
        schemaCode,
        schemaValue: schemaCode,
        parentSchema: schema,
        params: {},
        it
      };
    }
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/validate/defaults.js
var require_defaults = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/validate/defaults.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.assignDefaults = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    function assignDefaults(it, ty) {
      const { properties, items } = it.schema;
      if (ty === "object" && properties) {
        for (const key in properties) {
          assignDefault(it, key, properties[key].default);
        }
      } else if (ty === "array" && Array.isArray(items)) {
        items.forEach((sch, i) => assignDefault(it, i, sch.default));
      }
    }
    exports.assignDefaults = assignDefaults;
    function assignDefault(it, prop, defaultValue) {
      const { gen, compositeRule, data, opts } = it;
      if (defaultValue === void 0)
        return;
      const childData = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(prop)}`;
      if (compositeRule) {
        (0, util_1.checkStrictMode)(it, `default is ignored for: ${childData}`);
        return;
      }
      let condition = (0, codegen_1._)`${childData} === undefined`;
      if (opts.useDefaults === "empty") {
        condition = (0, codegen_1._)`${condition} || ${childData} === null || ${childData} === ""`;
      }
      gen.if(condition, (0, codegen_1._)`${childData} = ${(0, codegen_1.stringify)(defaultValue)}`);
    }
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/code.js
var require_code2 = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/code.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.validateUnion = exports.validateArray = exports.usePattern = exports.callValidateCode = exports.schemaProperties = exports.allSchemaProperties = exports.noPropertyInData = exports.propertyInData = exports.isOwnProperty = exports.hasPropFunc = exports.reportMissingProp = exports.checkMissingProp = exports.checkReportMissingProp = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var names_1 = require_names();
    var util_2 = require_util();
    function checkReportMissingProp(cxt, prop) {
      const { gen, data, it } = cxt;
      gen.if(noPropertyInData(gen, data, prop, it.opts.ownProperties), () => {
        cxt.setParams({ missingProperty: (0, codegen_1._)`${prop}` }, true);
        cxt.error();
      });
    }
    exports.checkReportMissingProp = checkReportMissingProp;
    function checkMissingProp({ gen, data, it: { opts } }, properties, missing) {
      return (0, codegen_1.or)(...properties.map((prop) => (0, codegen_1.and)(noPropertyInData(gen, data, prop, opts.ownProperties), (0, codegen_1._)`${missing} = ${prop}`)));
    }
    exports.checkMissingProp = checkMissingProp;
    function reportMissingProp(cxt, missing) {
      cxt.setParams({ missingProperty: missing }, true);
      cxt.error();
    }
    exports.reportMissingProp = reportMissingProp;
    function hasPropFunc(gen) {
      return gen.scopeValue("func", {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        ref: Object.prototype.hasOwnProperty,
        code: (0, codegen_1._)`Object.prototype.hasOwnProperty`
      });
    }
    exports.hasPropFunc = hasPropFunc;
    function isOwnProperty(gen, data, property) {
      return (0, codegen_1._)`${hasPropFunc(gen)}.call(${data}, ${property})`;
    }
    exports.isOwnProperty = isOwnProperty;
    function propertyInData(gen, data, property, ownProperties) {
      const cond = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(property)} !== undefined`;
      return ownProperties ? (0, codegen_1._)`${cond} && ${isOwnProperty(gen, data, property)}` : cond;
    }
    exports.propertyInData = propertyInData;
    function noPropertyInData(gen, data, property, ownProperties) {
      const cond = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(property)} === undefined`;
      return ownProperties ? (0, codegen_1.or)(cond, (0, codegen_1.not)(isOwnProperty(gen, data, property))) : cond;
    }
    exports.noPropertyInData = noPropertyInData;
    function allSchemaProperties(schemaMap) {
      return schemaMap ? Object.keys(schemaMap).filter((p) => p !== "__proto__") : [];
    }
    exports.allSchemaProperties = allSchemaProperties;
    function schemaProperties(it, schemaMap) {
      return allSchemaProperties(schemaMap).filter((p) => !(0, util_1.alwaysValidSchema)(it, schemaMap[p]));
    }
    exports.schemaProperties = schemaProperties;
    function callValidateCode({ schemaCode, data, it: { gen, topSchemaRef, schemaPath, errorPath }, it }, func, context, passSchema) {
      const dataAndSchema = passSchema ? (0, codegen_1._)`${schemaCode}, ${data}, ${topSchemaRef}${schemaPath}` : data;
      const valCxt = [
        [names_1.default.instancePath, (0, codegen_1.strConcat)(names_1.default.instancePath, errorPath)],
        [names_1.default.parentData, it.parentData],
        [names_1.default.parentDataProperty, it.parentDataProperty],
        [names_1.default.rootData, names_1.default.rootData]
      ];
      if (it.opts.dynamicRef)
        valCxt.push([names_1.default.dynamicAnchors, names_1.default.dynamicAnchors]);
      const args = (0, codegen_1._)`${dataAndSchema}, ${gen.object(...valCxt)}`;
      return context !== codegen_1.nil ? (0, codegen_1._)`${func}.call(${context}, ${args})` : (0, codegen_1._)`${func}(${args})`;
    }
    exports.callValidateCode = callValidateCode;
    var newRegExp = (0, codegen_1._)`new RegExp`;
    function usePattern({ gen, it: { opts } }, pattern) {
      const u = opts.unicodeRegExp ? "u" : "";
      const { regExp } = opts.code;
      const rx = regExp(pattern, u);
      return gen.scopeValue("pattern", {
        key: rx.toString(),
        ref: rx,
        code: (0, codegen_1._)`${regExp.code === "new RegExp" ? newRegExp : (0, util_2.useFunc)(gen, regExp)}(${pattern}, ${u})`
      });
    }
    exports.usePattern = usePattern;
    function validateArray(cxt) {
      const { gen, data, keyword, it } = cxt;
      const valid = gen.name("valid");
      if (it.allErrors) {
        const validArr = gen.let("valid", true);
        validateItems(() => gen.assign(validArr, false));
        return validArr;
      }
      gen.var(valid, true);
      validateItems(() => gen.break());
      return valid;
      function validateItems(notValid) {
        const len = gen.const("len", (0, codegen_1._)`${data}.length`);
        gen.forRange("i", 0, len, (i) => {
          cxt.subschema({
            keyword,
            dataProp: i,
            dataPropType: util_1.Type.Num
          }, valid);
          gen.if((0, codegen_1.not)(valid), notValid);
        });
      }
    }
    exports.validateArray = validateArray;
    function validateUnion(cxt) {
      const { gen, schema, keyword, it } = cxt;
      if (!Array.isArray(schema))
        throw new Error("ajv implementation error");
      const alwaysValid = schema.some((sch) => (0, util_1.alwaysValidSchema)(it, sch));
      if (alwaysValid && !it.opts.unevaluated)
        return;
      const valid = gen.let("valid", false);
      const schValid = gen.name("_valid");
      gen.block(() => schema.forEach((_sch, i) => {
        const schCxt = cxt.subschema({
          keyword,
          schemaProp: i,
          compositeRule: true
        }, schValid);
        gen.assign(valid, (0, codegen_1._)`${valid} || ${schValid}`);
        const merged = cxt.mergeValidEvaluated(schCxt, schValid);
        if (!merged)
          gen.if((0, codegen_1.not)(valid));
      }));
      cxt.result(valid, () => cxt.reset(), () => cxt.error(true));
    }
    exports.validateUnion = validateUnion;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/validate/keyword.js
var require_keyword = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/validate/keyword.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.validateKeywordUsage = exports.validSchemaType = exports.funcKeywordCode = exports.macroKeywordCode = void 0;
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var code_1 = require_code2();
    var errors_1 = require_errors();
    function macroKeywordCode(cxt, def) {
      const { gen, keyword, schema, parentSchema, it } = cxt;
      const macroSchema = def.macro.call(it.self, schema, parentSchema, it);
      const schemaRef = useKeyword(gen, keyword, macroSchema);
      if (it.opts.validateSchema !== false)
        it.self.validateSchema(macroSchema, true);
      const valid = gen.name("valid");
      cxt.subschema({
        schema: macroSchema,
        schemaPath: codegen_1.nil,
        errSchemaPath: `${it.errSchemaPath}/${keyword}`,
        topSchemaRef: schemaRef,
        compositeRule: true
      }, valid);
      cxt.pass(valid, () => cxt.error(true));
    }
    exports.macroKeywordCode = macroKeywordCode;
    function funcKeywordCode(cxt, def) {
      var _a;
      const { gen, keyword, schema, parentSchema, $data, it } = cxt;
      checkAsyncKeyword(it, def);
      const validate2 = !$data && def.compile ? def.compile.call(it.self, schema, parentSchema, it) : def.validate;
      const validateRef = useKeyword(gen, keyword, validate2);
      const valid = gen.let("valid");
      cxt.block$data(valid, validateKeyword);
      cxt.ok((_a = def.valid) !== null && _a !== void 0 ? _a : valid);
      function validateKeyword() {
        if (def.errors === false) {
          assignValid();
          if (def.modifying)
            modifyData(cxt);
          reportErrs(() => cxt.error());
        } else {
          const ruleErrs = def.async ? validateAsync() : validateSync();
          if (def.modifying)
            modifyData(cxt);
          reportErrs(() => addErrs(cxt, ruleErrs));
        }
      }
      function validateAsync() {
        const ruleErrs = gen.let("ruleErrs", null);
        gen.try(() => assignValid((0, codegen_1._)`await `), (e) => gen.assign(valid, false).if((0, codegen_1._)`${e} instanceof ${it.ValidationError}`, () => gen.assign(ruleErrs, (0, codegen_1._)`${e}.errors`), () => gen.throw(e)));
        return ruleErrs;
      }
      function validateSync() {
        const validateErrs = (0, codegen_1._)`${validateRef}.errors`;
        gen.assign(validateErrs, null);
        assignValid(codegen_1.nil);
        return validateErrs;
      }
      function assignValid(_await = def.async ? (0, codegen_1._)`await ` : codegen_1.nil) {
        const passCxt = it.opts.passContext ? names_1.default.this : names_1.default.self;
        const passSchema = !("compile" in def && !$data || def.schema === false);
        gen.assign(valid, (0, codegen_1._)`${_await}${(0, code_1.callValidateCode)(cxt, validateRef, passCxt, passSchema)}`, def.modifying);
      }
      function reportErrs(errors) {
        var _a2;
        gen.if((0, codegen_1.not)((_a2 = def.valid) !== null && _a2 !== void 0 ? _a2 : valid), errors);
      }
    }
    exports.funcKeywordCode = funcKeywordCode;
    function modifyData(cxt) {
      const { gen, data, it } = cxt;
      gen.if(it.parentData, () => gen.assign(data, (0, codegen_1._)`${it.parentData}[${it.parentDataProperty}]`));
    }
    function addErrs(cxt, errs) {
      const { gen } = cxt;
      gen.if((0, codegen_1._)`Array.isArray(${errs})`, () => {
        gen.assign(names_1.default.vErrors, (0, codegen_1._)`${names_1.default.vErrors} === null ? ${errs} : ${names_1.default.vErrors}.concat(${errs})`).assign(names_1.default.errors, (0, codegen_1._)`${names_1.default.vErrors}.length`);
        (0, errors_1.extendErrors)(cxt);
      }, () => cxt.error());
    }
    function checkAsyncKeyword({ schemaEnv }, def) {
      if (def.async && !schemaEnv.$async)
        throw new Error("async keyword in sync schema");
    }
    function useKeyword(gen, keyword, result2) {
      if (result2 === void 0)
        throw new Error(`keyword "${keyword}" failed to compile`);
      return gen.scopeValue("keyword", typeof result2 == "function" ? { ref: result2 } : { ref: result2, code: (0, codegen_1.stringify)(result2) });
    }
    function validSchemaType(schema, schemaType, allowUndefined = false) {
      return !schemaType.length || schemaType.some((st) => st === "array" ? Array.isArray(schema) : st === "object" ? schema && typeof schema == "object" && !Array.isArray(schema) : typeof schema == st || allowUndefined && typeof schema == "undefined");
    }
    exports.validSchemaType = validSchemaType;
    function validateKeywordUsage({ schema, opts, self, errSchemaPath }, def, keyword) {
      if (Array.isArray(def.keyword) ? !def.keyword.includes(keyword) : def.keyword !== keyword) {
        throw new Error("ajv implementation error");
      }
      const deps = def.dependencies;
      if (deps === null || deps === void 0 ? void 0 : deps.some((kwd) => !Object.prototype.hasOwnProperty.call(schema, kwd))) {
        throw new Error(`parent schema must have dependencies of ${keyword}: ${deps.join(",")}`);
      }
      if (def.validateSchema) {
        const valid = def.validateSchema(schema[keyword]);
        if (!valid) {
          const msg = `keyword "${keyword}" value is invalid at path "${errSchemaPath}": ` + self.errorsText(def.validateSchema.errors);
          if (opts.validateSchema === "log")
            self.logger.error(msg);
          else
            throw new Error(msg);
        }
      }
    }
    exports.validateKeywordUsage = validateKeywordUsage;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/validate/subschema.js
var require_subschema = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/validate/subschema.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.extendSubschemaMode = exports.extendSubschemaData = exports.getSubschema = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    function getSubschema(it, { keyword, schemaProp, schema, schemaPath, errSchemaPath, topSchemaRef }) {
      if (keyword !== void 0 && schema !== void 0) {
        throw new Error('both "keyword" and "schema" passed, only one allowed');
      }
      if (keyword !== void 0) {
        const sch = it.schema[keyword];
        return schemaProp === void 0 ? {
          schema: sch,
          schemaPath: (0, codegen_1._)`${it.schemaPath}${(0, codegen_1.getProperty)(keyword)}`,
          errSchemaPath: `${it.errSchemaPath}/${keyword}`
        } : {
          schema: sch[schemaProp],
          schemaPath: (0, codegen_1._)`${it.schemaPath}${(0, codegen_1.getProperty)(keyword)}${(0, codegen_1.getProperty)(schemaProp)}`,
          errSchemaPath: `${it.errSchemaPath}/${keyword}/${(0, util_1.escapeFragment)(schemaProp)}`
        };
      }
      if (schema !== void 0) {
        if (schemaPath === void 0 || errSchemaPath === void 0 || topSchemaRef === void 0) {
          throw new Error('"schemaPath", "errSchemaPath" and "topSchemaRef" are required with "schema"');
        }
        return {
          schema,
          schemaPath,
          topSchemaRef,
          errSchemaPath
        };
      }
      throw new Error('either "keyword" or "schema" must be passed');
    }
    exports.getSubschema = getSubschema;
    function extendSubschemaData(subschema, it, { dataProp, dataPropType: dpType, data, dataTypes, propertyName }) {
      if (data !== void 0 && dataProp !== void 0) {
        throw new Error('both "data" and "dataProp" passed, only one allowed');
      }
      const { gen } = it;
      if (dataProp !== void 0) {
        const { errorPath, dataPathArr, opts } = it;
        const nextData = gen.let("data", (0, codegen_1._)`${it.data}${(0, codegen_1.getProperty)(dataProp)}`, true);
        dataContextProps(nextData);
        subschema.errorPath = (0, codegen_1.str)`${errorPath}${(0, util_1.getErrorPath)(dataProp, dpType, opts.jsPropertySyntax)}`;
        subschema.parentDataProperty = (0, codegen_1._)`${dataProp}`;
        subschema.dataPathArr = [...dataPathArr, subschema.parentDataProperty];
      }
      if (data !== void 0) {
        const nextData = data instanceof codegen_1.Name ? data : gen.let("data", data, true);
        dataContextProps(nextData);
        if (propertyName !== void 0)
          subschema.propertyName = propertyName;
      }
      if (dataTypes)
        subschema.dataTypes = dataTypes;
      function dataContextProps(_nextData) {
        subschema.data = _nextData;
        subschema.dataLevel = it.dataLevel + 1;
        subschema.dataTypes = [];
        it.definedProperties = /* @__PURE__ */ new Set();
        subschema.parentData = it.data;
        subschema.dataNames = [...it.dataNames, _nextData];
      }
    }
    exports.extendSubschemaData = extendSubschemaData;
    function extendSubschemaMode(subschema, { jtdDiscriminator, jtdMetadata, compositeRule, createErrors, allErrors }) {
      if (compositeRule !== void 0)
        subschema.compositeRule = compositeRule;
      if (createErrors !== void 0)
        subschema.createErrors = createErrors;
      if (allErrors !== void 0)
        subschema.allErrors = allErrors;
      subschema.jtdDiscriminator = jtdDiscriminator;
      subschema.jtdMetadata = jtdMetadata;
    }
    exports.extendSubschemaMode = extendSubschemaMode;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/fast-deep-equal/index.js
var require_fast_deep_equal = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/fast-deep-equal/index.js"(exports, module) {
    "use strict";
    module.exports = function equal2(a, b) {
      if (a === b) return true;
      if (a && b && typeof a == "object" && typeof b == "object") {
        if (a.constructor !== b.constructor) return false;
        var length, i, keys;
        if (Array.isArray(a)) {
          length = a.length;
          if (length != b.length) return false;
          for (i = length; i-- !== 0; )
            if (!equal2(a[i], b[i])) return false;
          return true;
        }
        if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags;
        if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf();
        if (a.toString !== Object.prototype.toString) return a.toString() === b.toString();
        keys = Object.keys(a);
        length = keys.length;
        if (length !== Object.keys(b).length) return false;
        for (i = length; i-- !== 0; )
          if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false;
        for (i = length; i-- !== 0; ) {
          var key = keys[i];
          if (!equal2(a[key], b[key])) return false;
        }
        return true;
      }
      return a !== a && b !== b;
    };
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/json-schema-traverse/index.js
var require_json_schema_traverse = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/json-schema-traverse/index.js"(exports, module) {
    "use strict";
    var traverse = module.exports = function(schema, opts, cb) {
      if (typeof opts == "function") {
        cb = opts;
        opts = {};
      }
      cb = opts.cb || cb;
      var pre = typeof cb == "function" ? cb : cb.pre || function() {
      };
      var post = cb.post || function() {
      };
      _traverse(opts, pre, post, schema, "", schema);
    };
    traverse.keywords = {
      additionalItems: true,
      items: true,
      contains: true,
      additionalProperties: true,
      propertyNames: true,
      not: true,
      if: true,
      then: true,
      else: true
    };
    traverse.arrayKeywords = {
      items: true,
      allOf: true,
      anyOf: true,
      oneOf: true
    };
    traverse.propsKeywords = {
      $defs: true,
      definitions: true,
      properties: true,
      patternProperties: true,
      dependencies: true
    };
    traverse.skipKeywords = {
      default: true,
      enum: true,
      const: true,
      required: true,
      maximum: true,
      minimum: true,
      exclusiveMaximum: true,
      exclusiveMinimum: true,
      multipleOf: true,
      maxLength: true,
      minLength: true,
      pattern: true,
      format: true,
      maxItems: true,
      minItems: true,
      uniqueItems: true,
      maxProperties: true,
      minProperties: true
    };
    function _traverse(opts, pre, post, schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex) {
      if (schema && typeof schema == "object" && !Array.isArray(schema)) {
        pre(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
        for (var key in schema) {
          var sch = schema[key];
          if (Array.isArray(sch)) {
            if (key in traverse.arrayKeywords) {
              for (var i = 0; i < sch.length; i++)
                _traverse(opts, pre, post, sch[i], jsonPtr + "/" + key + "/" + i, rootSchema, jsonPtr, key, schema, i);
            }
          } else if (key in traverse.propsKeywords) {
            if (sch && typeof sch == "object") {
              for (var prop in sch)
                _traverse(opts, pre, post, sch[prop], jsonPtr + "/" + key + "/" + escapeJsonPtr(prop), rootSchema, jsonPtr, key, schema, prop);
            }
          } else if (key in traverse.keywords || opts.allKeys && !(key in traverse.skipKeywords)) {
            _traverse(opts, pre, post, sch, jsonPtr + "/" + key, rootSchema, jsonPtr, key, schema);
          }
        }
        post(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
      }
    }
    function escapeJsonPtr(str) {
      return str.replace(/~/g, "~0").replace(/\//g, "~1");
    }
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/resolve.js
var require_resolve = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/resolve.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getSchemaRefs = exports.resolveUrl = exports.normalizeId = exports._getFullPath = exports.getFullPath = exports.inlineRef = void 0;
    var util_1 = require_util();
    var equal2 = require_fast_deep_equal();
    var traverse = require_json_schema_traverse();
    var SIMPLE_INLINED = /* @__PURE__ */ new Set([
      "type",
      "format",
      "pattern",
      "maxLength",
      "minLength",
      "maxProperties",
      "minProperties",
      "maxItems",
      "minItems",
      "maximum",
      "minimum",
      "uniqueItems",
      "multipleOf",
      "required",
      "enum",
      "const"
    ]);
    function inlineRef(schema, limit = true) {
      if (typeof schema == "boolean")
        return true;
      if (limit === true)
        return !hasRef(schema);
      if (!limit)
        return false;
      return countKeys(schema) <= limit;
    }
    exports.inlineRef = inlineRef;
    var REF_KEYWORDS = /* @__PURE__ */ new Set([
      "$ref",
      "$recursiveRef",
      "$recursiveAnchor",
      "$dynamicRef",
      "$dynamicAnchor"
    ]);
    function hasRef(schema) {
      for (const key in schema) {
        if (REF_KEYWORDS.has(key))
          return true;
        const sch = schema[key];
        if (Array.isArray(sch) && sch.some(hasRef))
          return true;
        if (typeof sch == "object" && hasRef(sch))
          return true;
      }
      return false;
    }
    function countKeys(schema) {
      let count = 0;
      for (const key in schema) {
        if (key === "$ref")
          return Infinity;
        count++;
        if (SIMPLE_INLINED.has(key))
          continue;
        if (typeof schema[key] == "object") {
          (0, util_1.eachItem)(schema[key], (sch) => count += countKeys(sch));
        }
        if (count === Infinity)
          return Infinity;
      }
      return count;
    }
    function getFullPath(resolver, id = "", normalize5) {
      if (normalize5 !== false)
        id = normalizeId(id);
      const p = resolver.parse(id);
      return _getFullPath(resolver, p);
    }
    exports.getFullPath = getFullPath;
    function _getFullPath(resolver, p) {
      const serialized = resolver.serialize(p);
      return serialized.split("#")[0] + "#";
    }
    exports._getFullPath = _getFullPath;
    var TRAILING_SLASH_HASH = /#\/?$/;
    function normalizeId(id) {
      return id ? id.replace(TRAILING_SLASH_HASH, "") : "";
    }
    exports.normalizeId = normalizeId;
    function resolveUrl(resolver, baseId, id) {
      id = normalizeId(id);
      return resolver.resolve(baseId, id);
    }
    exports.resolveUrl = resolveUrl;
    var ANCHOR = /^[a-z_][-a-z0-9._]*$/i;
    function getSchemaRefs(schema, baseId) {
      if (typeof schema == "boolean")
        return {};
      const { schemaId, uriResolver } = this.opts;
      const schId = normalizeId(schema[schemaId] || baseId);
      const baseIds = { "": schId };
      const pathPrefix = getFullPath(uriResolver, schId, false);
      const localRefs = {};
      const schemaRefs = /* @__PURE__ */ new Set();
      traverse(schema, { allKeys: true }, (sch, jsonPtr, _, parentJsonPtr) => {
        if (parentJsonPtr === void 0)
          return;
        const fullPath = pathPrefix + jsonPtr;
        let innerBaseId = baseIds[parentJsonPtr];
        if (typeof sch[schemaId] == "string")
          innerBaseId = addRef.call(this, sch[schemaId]);
        addAnchor.call(this, sch.$anchor);
        addAnchor.call(this, sch.$dynamicAnchor);
        baseIds[jsonPtr] = innerBaseId;
        function addRef(ref) {
          const _resolve = this.opts.uriResolver.resolve;
          ref = normalizeId(innerBaseId ? _resolve(innerBaseId, ref) : ref);
          if (schemaRefs.has(ref))
            throw ambiguos(ref);
          schemaRefs.add(ref);
          let schOrRef = this.refs[ref];
          if (typeof schOrRef == "string")
            schOrRef = this.refs[schOrRef];
          if (typeof schOrRef == "object") {
            checkAmbiguosRef(sch, schOrRef.schema, ref);
          } else if (ref !== normalizeId(fullPath)) {
            if (ref[0] === "#") {
              checkAmbiguosRef(sch, localRefs[ref], ref);
              localRefs[ref] = sch;
            } else {
              this.refs[ref] = fullPath;
            }
          }
          return ref;
        }
        function addAnchor(anchor) {
          if (typeof anchor == "string") {
            if (!ANCHOR.test(anchor))
              throw new Error(`invalid anchor "${anchor}"`);
            addRef.call(this, `#${anchor}`);
          }
        }
      });
      return localRefs;
      function checkAmbiguosRef(sch1, sch2, ref) {
        if (sch2 !== void 0 && !equal2(sch1, sch2))
          throw ambiguos(ref);
      }
      function ambiguos(ref) {
        return new Error(`reference "${ref}" resolves to more than one schema`);
      }
    }
    exports.getSchemaRefs = getSchemaRefs;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/validate/index.js
var require_validate = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/validate/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getData = exports.KeywordCxt = exports.validateFunctionCode = void 0;
    var boolSchema_1 = require_boolSchema();
    var dataType_1 = require_dataType();
    var applicability_1 = require_applicability();
    var dataType_2 = require_dataType();
    var defaults_1 = require_defaults();
    var keyword_1 = require_keyword();
    var subschema_1 = require_subschema();
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var resolve_1 = require_resolve();
    var util_1 = require_util();
    var errors_1 = require_errors();
    function validateFunctionCode(it) {
      if (isSchemaObj(it)) {
        checkKeywords(it);
        if (schemaCxtHasRules(it)) {
          topSchemaObjCode(it);
          return;
        }
      }
      validateFunction(it, () => (0, boolSchema_1.topBoolOrEmptySchema)(it));
    }
    exports.validateFunctionCode = validateFunctionCode;
    function validateFunction({ gen, validateName, schema, schemaEnv, opts }, body) {
      if (opts.code.es5) {
        gen.func(validateName, (0, codegen_1._)`${names_1.default.data}, ${names_1.default.valCxt}`, schemaEnv.$async, () => {
          gen.code((0, codegen_1._)`"use strict"; ${funcSourceUrl(schema, opts)}`);
          destructureValCxtES5(gen, opts);
          gen.code(body);
        });
      } else {
        gen.func(validateName, (0, codegen_1._)`${names_1.default.data}, ${destructureValCxt(opts)}`, schemaEnv.$async, () => gen.code(funcSourceUrl(schema, opts)).code(body));
      }
    }
    function destructureValCxt(opts) {
      return (0, codegen_1._)`{${names_1.default.instancePath}="", ${names_1.default.parentData}, ${names_1.default.parentDataProperty}, ${names_1.default.rootData}=${names_1.default.data}${opts.dynamicRef ? (0, codegen_1._)`, ${names_1.default.dynamicAnchors}={}` : codegen_1.nil}}={}`;
    }
    function destructureValCxtES5(gen, opts) {
      gen.if(names_1.default.valCxt, () => {
        gen.var(names_1.default.instancePath, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.instancePath}`);
        gen.var(names_1.default.parentData, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.parentData}`);
        gen.var(names_1.default.parentDataProperty, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.parentDataProperty}`);
        gen.var(names_1.default.rootData, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.rootData}`);
        if (opts.dynamicRef)
          gen.var(names_1.default.dynamicAnchors, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.dynamicAnchors}`);
      }, () => {
        gen.var(names_1.default.instancePath, (0, codegen_1._)`""`);
        gen.var(names_1.default.parentData, (0, codegen_1._)`undefined`);
        gen.var(names_1.default.parentDataProperty, (0, codegen_1._)`undefined`);
        gen.var(names_1.default.rootData, names_1.default.data);
        if (opts.dynamicRef)
          gen.var(names_1.default.dynamicAnchors, (0, codegen_1._)`{}`);
      });
    }
    function topSchemaObjCode(it) {
      const { schema, opts, gen } = it;
      validateFunction(it, () => {
        if (opts.$comment && schema.$comment)
          commentKeyword(it);
        checkNoDefault(it);
        gen.let(names_1.default.vErrors, null);
        gen.let(names_1.default.errors, 0);
        if (opts.unevaluated)
          resetEvaluated(it);
        typeAndKeywords(it);
        returnResults(it);
      });
      return;
    }
    function resetEvaluated(it) {
      const { gen, validateName } = it;
      it.evaluated = gen.const("evaluated", (0, codegen_1._)`${validateName}.evaluated`);
      gen.if((0, codegen_1._)`${it.evaluated}.dynamicProps`, () => gen.assign((0, codegen_1._)`${it.evaluated}.props`, (0, codegen_1._)`undefined`));
      gen.if((0, codegen_1._)`${it.evaluated}.dynamicItems`, () => gen.assign((0, codegen_1._)`${it.evaluated}.items`, (0, codegen_1._)`undefined`));
    }
    function funcSourceUrl(schema, opts) {
      const schId = typeof schema == "object" && schema[opts.schemaId];
      return schId && (opts.code.source || opts.code.process) ? (0, codegen_1._)`/*# sourceURL=${schId} */` : codegen_1.nil;
    }
    function subschemaCode(it, valid) {
      if (isSchemaObj(it)) {
        checkKeywords(it);
        if (schemaCxtHasRules(it)) {
          subSchemaObjCode(it, valid);
          return;
        }
      }
      (0, boolSchema_1.boolOrEmptySchema)(it, valid);
    }
    function schemaCxtHasRules({ schema, self }) {
      if (typeof schema == "boolean")
        return !schema;
      for (const key in schema)
        if (self.RULES.all[key])
          return true;
      return false;
    }
    function isSchemaObj(it) {
      return typeof it.schema != "boolean";
    }
    function subSchemaObjCode(it, valid) {
      const { schema, gen, opts } = it;
      if (opts.$comment && schema.$comment)
        commentKeyword(it);
      updateContext(it);
      checkAsyncSchema(it);
      const errsCount = gen.const("_errs", names_1.default.errors);
      typeAndKeywords(it, errsCount);
      gen.var(valid, (0, codegen_1._)`${errsCount} === ${names_1.default.errors}`);
    }
    function checkKeywords(it) {
      (0, util_1.checkUnknownRules)(it);
      checkRefsAndKeywords(it);
    }
    function typeAndKeywords(it, errsCount) {
      if (it.opts.jtd)
        return schemaKeywords(it, [], false, errsCount);
      const types = (0, dataType_1.getSchemaTypes)(it.schema);
      const checkedTypes = (0, dataType_1.coerceAndCheckDataType)(it, types);
      schemaKeywords(it, types, !checkedTypes, errsCount);
    }
    function checkRefsAndKeywords(it) {
      const { schema, errSchemaPath, opts, self } = it;
      if (schema.$ref && opts.ignoreKeywordsWithRef && (0, util_1.schemaHasRulesButRef)(schema, self.RULES)) {
        self.logger.warn(`$ref: keywords ignored in schema at path "${errSchemaPath}"`);
      }
    }
    function checkNoDefault(it) {
      const { schema, opts } = it;
      if (schema.default !== void 0 && opts.useDefaults && opts.strictSchema) {
        (0, util_1.checkStrictMode)(it, "default is ignored in the schema root");
      }
    }
    function updateContext(it) {
      const schId = it.schema[it.opts.schemaId];
      if (schId)
        it.baseId = (0, resolve_1.resolveUrl)(it.opts.uriResolver, it.baseId, schId);
    }
    function checkAsyncSchema(it) {
      if (it.schema.$async && !it.schemaEnv.$async)
        throw new Error("async schema in sync schema");
    }
    function commentKeyword({ gen, schemaEnv, schema, errSchemaPath, opts }) {
      const msg = schema.$comment;
      if (opts.$comment === true) {
        gen.code((0, codegen_1._)`${names_1.default.self}.logger.log(${msg})`);
      } else if (typeof opts.$comment == "function") {
        const schemaPath = (0, codegen_1.str)`${errSchemaPath}/$comment`;
        const rootName = gen.scopeValue("root", { ref: schemaEnv.root });
        gen.code((0, codegen_1._)`${names_1.default.self}.opts.$comment(${msg}, ${schemaPath}, ${rootName}.schema)`);
      }
    }
    function returnResults(it) {
      const { gen, schemaEnv, validateName, ValidationError, opts } = it;
      if (schemaEnv.$async) {
        gen.if((0, codegen_1._)`${names_1.default.errors} === 0`, () => gen.return(names_1.default.data), () => gen.throw((0, codegen_1._)`new ${ValidationError}(${names_1.default.vErrors})`));
      } else {
        gen.assign((0, codegen_1._)`${validateName}.errors`, names_1.default.vErrors);
        if (opts.unevaluated)
          assignEvaluated(it);
        gen.return((0, codegen_1._)`${names_1.default.errors} === 0`);
      }
    }
    function assignEvaluated({ gen, evaluated, props, items }) {
      if (props instanceof codegen_1.Name)
        gen.assign((0, codegen_1._)`${evaluated}.props`, props);
      if (items instanceof codegen_1.Name)
        gen.assign((0, codegen_1._)`${evaluated}.items`, items);
    }
    function schemaKeywords(it, types, typeErrors, errsCount) {
      const { gen, schema, data, allErrors, opts, self } = it;
      const { RULES } = self;
      if (schema.$ref && (opts.ignoreKeywordsWithRef || !(0, util_1.schemaHasRulesButRef)(schema, RULES))) {
        gen.block(() => keywordCode(it, "$ref", RULES.all.$ref.definition));
        return;
      }
      if (!opts.jtd)
        checkStrictTypes(it, types);
      gen.block(() => {
        for (const group of RULES.rules)
          groupKeywords(group);
        groupKeywords(RULES.post);
      });
      function groupKeywords(group) {
        if (!(0, applicability_1.shouldUseGroup)(schema, group))
          return;
        if (group.type) {
          gen.if((0, dataType_2.checkDataType)(group.type, data, opts.strictNumbers));
          iterateKeywords(it, group);
          if (types.length === 1 && types[0] === group.type && typeErrors) {
            gen.else();
            (0, dataType_2.reportTypeError)(it);
          }
          gen.endIf();
        } else {
          iterateKeywords(it, group);
        }
        if (!allErrors)
          gen.if((0, codegen_1._)`${names_1.default.errors} === ${errsCount || 0}`);
      }
    }
    function iterateKeywords(it, group) {
      const { gen, schema, opts: { useDefaults } } = it;
      if (useDefaults)
        (0, defaults_1.assignDefaults)(it, group.type);
      gen.block(() => {
        for (const rule of group.rules) {
          if ((0, applicability_1.shouldUseRule)(schema, rule)) {
            keywordCode(it, rule.keyword, rule.definition, group.type);
          }
        }
      });
    }
    function checkStrictTypes(it, types) {
      if (it.schemaEnv.meta || !it.opts.strictTypes)
        return;
      checkContextTypes(it, types);
      if (!it.opts.allowUnionTypes)
        checkMultipleTypes(it, types);
      checkKeywordTypes(it, it.dataTypes);
    }
    function checkContextTypes(it, types) {
      if (!types.length)
        return;
      if (!it.dataTypes.length) {
        it.dataTypes = types;
        return;
      }
      types.forEach((t) => {
        if (!includesType(it.dataTypes, t)) {
          strictTypesError(it, `type "${t}" not allowed by context "${it.dataTypes.join(",")}"`);
        }
      });
      narrowSchemaTypes(it, types);
    }
    function checkMultipleTypes(it, ts) {
      if (ts.length > 1 && !(ts.length === 2 && ts.includes("null"))) {
        strictTypesError(it, "use allowUnionTypes to allow union type keyword");
      }
    }
    function checkKeywordTypes(it, ts) {
      const rules = it.self.RULES.all;
      for (const keyword in rules) {
        const rule = rules[keyword];
        if (typeof rule == "object" && (0, applicability_1.shouldUseRule)(it.schema, rule)) {
          const { type } = rule.definition;
          if (type.length && !type.some((t) => hasApplicableType(ts, t))) {
            strictTypesError(it, `missing type "${type.join(",")}" for keyword "${keyword}"`);
          }
        }
      }
    }
    function hasApplicableType(schTs, kwdT) {
      return schTs.includes(kwdT) || kwdT === "number" && schTs.includes("integer");
    }
    function includesType(ts, t) {
      return ts.includes(t) || t === "integer" && ts.includes("number");
    }
    function narrowSchemaTypes(it, withTypes) {
      const ts = [];
      for (const t of it.dataTypes) {
        if (includesType(withTypes, t))
          ts.push(t);
        else if (withTypes.includes("integer") && t === "number")
          ts.push("integer");
      }
      it.dataTypes = ts;
    }
    function strictTypesError(it, msg) {
      const schemaPath = it.schemaEnv.baseId + it.errSchemaPath;
      msg += ` at "${schemaPath}" (strictTypes)`;
      (0, util_1.checkStrictMode)(it, msg, it.opts.strictTypes);
    }
    var KeywordCxt = class {
      constructor(it, def, keyword) {
        (0, keyword_1.validateKeywordUsage)(it, def, keyword);
        this.gen = it.gen;
        this.allErrors = it.allErrors;
        this.keyword = keyword;
        this.data = it.data;
        this.schema = it.schema[keyword];
        this.$data = def.$data && it.opts.$data && this.schema && this.schema.$data;
        this.schemaValue = (0, util_1.schemaRefOrVal)(it, this.schema, keyword, this.$data);
        this.schemaType = def.schemaType;
        this.parentSchema = it.schema;
        this.params = {};
        this.it = it;
        this.def = def;
        if (this.$data) {
          this.schemaCode = it.gen.const("vSchema", getData(this.$data, it));
        } else {
          this.schemaCode = this.schemaValue;
          if (!(0, keyword_1.validSchemaType)(this.schema, def.schemaType, def.allowUndefined)) {
            throw new Error(`${keyword} value must be ${JSON.stringify(def.schemaType)}`);
          }
        }
        if ("code" in def ? def.trackErrors : def.errors !== false) {
          this.errsCount = it.gen.const("_errs", names_1.default.errors);
        }
      }
      result(condition, successAction, failAction) {
        this.failResult((0, codegen_1.not)(condition), successAction, failAction);
      }
      failResult(condition, successAction, failAction) {
        this.gen.if(condition);
        if (failAction)
          failAction();
        else
          this.error();
        if (successAction) {
          this.gen.else();
          successAction();
          if (this.allErrors)
            this.gen.endIf();
        } else {
          if (this.allErrors)
            this.gen.endIf();
          else
            this.gen.else();
        }
      }
      pass(condition, failAction) {
        this.failResult((0, codegen_1.not)(condition), void 0, failAction);
      }
      fail(condition) {
        if (condition === void 0) {
          this.error();
          if (!this.allErrors)
            this.gen.if(false);
          return;
        }
        this.gen.if(condition);
        this.error();
        if (this.allErrors)
          this.gen.endIf();
        else
          this.gen.else();
      }
      fail$data(condition) {
        if (!this.$data)
          return this.fail(condition);
        const { schemaCode } = this;
        this.fail((0, codegen_1._)`${schemaCode} !== undefined && (${(0, codegen_1.or)(this.invalid$data(), condition)})`);
      }
      error(append, errorParams, errorPaths) {
        if (errorParams) {
          this.setParams(errorParams);
          this._error(append, errorPaths);
          this.setParams({});
          return;
        }
        this._error(append, errorPaths);
      }
      _error(append, errorPaths) {
        ;
        (append ? errors_1.reportExtraError : errors_1.reportError)(this, this.def.error, errorPaths);
      }
      $dataError() {
        (0, errors_1.reportError)(this, this.def.$dataError || errors_1.keyword$DataError);
      }
      reset() {
        if (this.errsCount === void 0)
          throw new Error('add "trackErrors" to keyword definition');
        (0, errors_1.resetErrorsCount)(this.gen, this.errsCount);
      }
      ok(cond) {
        if (!this.allErrors)
          this.gen.if(cond);
      }
      setParams(obj, assign) {
        if (assign)
          Object.assign(this.params, obj);
        else
          this.params = obj;
      }
      block$data(valid, codeBlock, $dataValid = codegen_1.nil) {
        this.gen.block(() => {
          this.check$data(valid, $dataValid);
          codeBlock();
        });
      }
      check$data(valid = codegen_1.nil, $dataValid = codegen_1.nil) {
        if (!this.$data)
          return;
        const { gen, schemaCode, schemaType, def } = this;
        gen.if((0, codegen_1.or)((0, codegen_1._)`${schemaCode} === undefined`, $dataValid));
        if (valid !== codegen_1.nil)
          gen.assign(valid, true);
        if (schemaType.length || def.validateSchema) {
          gen.elseIf(this.invalid$data());
          this.$dataError();
          if (valid !== codegen_1.nil)
            gen.assign(valid, false);
        }
        gen.else();
      }
      invalid$data() {
        const { gen, schemaCode, schemaType, def, it } = this;
        return (0, codegen_1.or)(wrong$DataType(), invalid$DataSchema());
        function wrong$DataType() {
          if (schemaType.length) {
            if (!(schemaCode instanceof codegen_1.Name))
              throw new Error("ajv implementation error");
            const st = Array.isArray(schemaType) ? schemaType : [schemaType];
            return (0, codegen_1._)`${(0, dataType_2.checkDataTypes)(st, schemaCode, it.opts.strictNumbers, dataType_2.DataType.Wrong)}`;
          }
          return codegen_1.nil;
        }
        function invalid$DataSchema() {
          if (def.validateSchema) {
            const validateSchemaRef = gen.scopeValue("validate$data", { ref: def.validateSchema });
            return (0, codegen_1._)`!${validateSchemaRef}(${schemaCode})`;
          }
          return codegen_1.nil;
        }
      }
      subschema(appl, valid) {
        const subschema = (0, subschema_1.getSubschema)(this.it, appl);
        (0, subschema_1.extendSubschemaData)(subschema, this.it, appl);
        (0, subschema_1.extendSubschemaMode)(subschema, appl);
        const nextContext = { ...this.it, ...subschema, items: void 0, props: void 0 };
        subschemaCode(nextContext, valid);
        return nextContext;
      }
      mergeEvaluated(schemaCxt, toName) {
        const { it, gen } = this;
        if (!it.opts.unevaluated)
          return;
        if (it.props !== true && schemaCxt.props !== void 0) {
          it.props = util_1.mergeEvaluated.props(gen, schemaCxt.props, it.props, toName);
        }
        if (it.items !== true && schemaCxt.items !== void 0) {
          it.items = util_1.mergeEvaluated.items(gen, schemaCxt.items, it.items, toName);
        }
      }
      mergeValidEvaluated(schemaCxt, valid) {
        const { it, gen } = this;
        if (it.opts.unevaluated && (it.props !== true || it.items !== true)) {
          gen.if(valid, () => this.mergeEvaluated(schemaCxt, codegen_1.Name));
          return true;
        }
      }
    };
    exports.KeywordCxt = KeywordCxt;
    function keywordCode(it, keyword, def, ruleType) {
      const cxt = new KeywordCxt(it, def, keyword);
      if ("code" in def) {
        def.code(cxt, ruleType);
      } else if (cxt.$data && def.validate) {
        (0, keyword_1.funcKeywordCode)(cxt, def);
      } else if ("macro" in def) {
        (0, keyword_1.macroKeywordCode)(cxt, def);
      } else if (def.compile || def.validate) {
        (0, keyword_1.funcKeywordCode)(cxt, def);
      }
    }
    var JSON_POINTER = /^\/(?:[^~]|~0|~1)*$/;
    var RELATIVE_JSON_POINTER = /^([0-9]+)(#|\/(?:[^~]|~0|~1)*)?$/;
    function getData($data, { dataLevel, dataNames, dataPathArr }) {
      let jsonPointer;
      let data;
      if ($data === "")
        return names_1.default.rootData;
      if ($data[0] === "/") {
        if (!JSON_POINTER.test($data))
          throw new Error(`Invalid JSON-pointer: ${$data}`);
        jsonPointer = $data;
        data = names_1.default.rootData;
      } else {
        const matches = RELATIVE_JSON_POINTER.exec($data);
        if (!matches)
          throw new Error(`Invalid JSON-pointer: ${$data}`);
        const up = +matches[1];
        jsonPointer = matches[2];
        if (jsonPointer === "#") {
          if (up >= dataLevel)
            throw new Error(errorMsg("property/index", up));
          return dataPathArr[dataLevel - up];
        }
        if (up > dataLevel)
          throw new Error(errorMsg("data", up));
        data = dataNames[dataLevel - up];
        if (!jsonPointer)
          return data;
      }
      let expr = data;
      const segments = jsonPointer.split("/");
      for (const segment of segments) {
        if (segment) {
          data = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)((0, util_1.unescapeJsonPointer)(segment))}`;
          expr = (0, codegen_1._)`${expr} && ${data}`;
        }
      }
      return expr;
      function errorMsg(pointerType, up) {
        return `Cannot access ${pointerType} ${up} levels up, current level is ${dataLevel}`;
      }
    }
    exports.getData = getData;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/runtime/validation_error.js
var require_validation_error = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/runtime/validation_error.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var ValidationError = class extends Error {
      constructor(errors) {
        super("validation failed");
        this.errors = errors;
        this.ajv = this.validation = true;
      }
    };
    exports.default = ValidationError;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/ref_error.js
var require_ref_error = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/ref_error.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var resolve_1 = require_resolve();
    var MissingRefError = class extends Error {
      constructor(resolver, baseId, ref, msg) {
        super(msg || `can't resolve reference ${ref} from id ${baseId}`);
        this.missingRef = (0, resolve_1.resolveUrl)(resolver, baseId, ref);
        this.missingSchema = (0, resolve_1.normalizeId)((0, resolve_1.getFullPath)(resolver, this.missingRef));
      }
    };
    exports.default = MissingRefError;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/index.js
var require_compile = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/compile/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.resolveSchema = exports.getCompilingSchema = exports.resolveRef = exports.compileSchema = exports.SchemaEnv = void 0;
    var codegen_1 = require_codegen();
    var validation_error_1 = require_validation_error();
    var names_1 = require_names();
    var resolve_1 = require_resolve();
    var util_1 = require_util();
    var validate_1 = require_validate();
    var SchemaEnv = class {
      constructor(env) {
        var _a;
        this.refs = {};
        this.dynamicAnchors = {};
        let schema;
        if (typeof env.schema == "object")
          schema = env.schema;
        this.schema = env.schema;
        this.schemaId = env.schemaId;
        this.root = env.root || this;
        this.baseId = (_a = env.baseId) !== null && _a !== void 0 ? _a : (0, resolve_1.normalizeId)(schema === null || schema === void 0 ? void 0 : schema[env.schemaId || "$id"]);
        this.schemaPath = env.schemaPath;
        this.localRefs = env.localRefs;
        this.meta = env.meta;
        this.$async = schema === null || schema === void 0 ? void 0 : schema.$async;
        this.refs = {};
      }
    };
    exports.SchemaEnv = SchemaEnv;
    function compileSchema(sch) {
      const _sch = getCompilingSchema.call(this, sch);
      if (_sch)
        return _sch;
      const rootId = (0, resolve_1.getFullPath)(this.opts.uriResolver, sch.root.baseId);
      const { es5, lines: lines2 } = this.opts.code;
      const { ownProperties } = this.opts;
      const gen = new codegen_1.CodeGen(this.scope, { es5, lines: lines2, ownProperties });
      let _ValidationError;
      if (sch.$async) {
        _ValidationError = gen.scopeValue("Error", {
          ref: validation_error_1.default,
          code: (0, codegen_1._)`require("ajv/dist/runtime/validation_error").default`
        });
      }
      const validateName = gen.scopeName("validate");
      sch.validateName = validateName;
      const schemaCxt = {
        gen,
        allErrors: this.opts.allErrors,
        data: names_1.default.data,
        parentData: names_1.default.parentData,
        parentDataProperty: names_1.default.parentDataProperty,
        dataNames: [names_1.default.data],
        dataPathArr: [codegen_1.nil],
        // TODO can its length be used as dataLevel if nil is removed?
        dataLevel: 0,
        dataTypes: [],
        definedProperties: /* @__PURE__ */ new Set(),
        topSchemaRef: gen.scopeValue("schema", this.opts.code.source === true ? { ref: sch.schema, code: (0, codegen_1.stringify)(sch.schema) } : { ref: sch.schema }),
        validateName,
        ValidationError: _ValidationError,
        schema: sch.schema,
        schemaEnv: sch,
        rootId,
        baseId: sch.baseId || rootId,
        schemaPath: codegen_1.nil,
        errSchemaPath: sch.schemaPath || (this.opts.jtd ? "" : "#"),
        errorPath: (0, codegen_1._)`""`,
        opts: this.opts,
        self: this
      };
      let sourceCode;
      try {
        this._compilations.add(sch);
        (0, validate_1.validateFunctionCode)(schemaCxt);
        gen.optimize(this.opts.code.optimize);
        const validateCode = gen.toString();
        sourceCode = `${gen.scopeRefs(names_1.default.scope)}return ${validateCode}`;
        if (this.opts.code.process)
          sourceCode = this.opts.code.process(sourceCode, sch);
        const makeValidate = new Function(`${names_1.default.self}`, `${names_1.default.scope}`, sourceCode);
        const validate2 = makeValidate(this, this.scope.get());
        this.scope.value(validateName, { ref: validate2 });
        validate2.errors = null;
        validate2.schema = sch.schema;
        validate2.schemaEnv = sch;
        if (sch.$async)
          validate2.$async = true;
        if (this.opts.code.source === true) {
          validate2.source = { validateName, validateCode, scopeValues: gen._values };
        }
        if (this.opts.unevaluated) {
          const { props, items } = schemaCxt;
          validate2.evaluated = {
            props: props instanceof codegen_1.Name ? void 0 : props,
            items: items instanceof codegen_1.Name ? void 0 : items,
            dynamicProps: props instanceof codegen_1.Name,
            dynamicItems: items instanceof codegen_1.Name
          };
          if (validate2.source)
            validate2.source.evaluated = (0, codegen_1.stringify)(validate2.evaluated);
        }
        sch.validate = validate2;
        return sch;
      } catch (e) {
        delete sch.validate;
        delete sch.validateName;
        if (sourceCode)
          this.logger.error("Error compiling schema, function code:", sourceCode);
        throw e;
      } finally {
        this._compilations.delete(sch);
      }
    }
    exports.compileSchema = compileSchema;
    function resolveRef(root, baseId, ref) {
      var _a;
      ref = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, ref);
      const schOrFunc = root.refs[ref];
      if (schOrFunc)
        return schOrFunc;
      let _sch = resolve5.call(this, root, ref);
      if (_sch === void 0) {
        const schema = (_a = root.localRefs) === null || _a === void 0 ? void 0 : _a[ref];
        const { schemaId } = this.opts;
        if (schema)
          _sch = new SchemaEnv({ schema, schemaId, root, baseId });
      }
      if (_sch === void 0)
        return;
      return root.refs[ref] = inlineOrCompile.call(this, _sch);
    }
    exports.resolveRef = resolveRef;
    function inlineOrCompile(sch) {
      if ((0, resolve_1.inlineRef)(sch.schema, this.opts.inlineRefs))
        return sch.schema;
      return sch.validate ? sch : compileSchema.call(this, sch);
    }
    function getCompilingSchema(schEnv) {
      for (const sch of this._compilations) {
        if (sameSchemaEnv(sch, schEnv))
          return sch;
      }
    }
    exports.getCompilingSchema = getCompilingSchema;
    function sameSchemaEnv(s1, s2) {
      return s1.schema === s2.schema && s1.root === s2.root && s1.baseId === s2.baseId;
    }
    function resolve5(root, ref) {
      let sch;
      while (typeof (sch = this.refs[ref]) == "string")
        ref = sch;
      return sch || this.schemas[ref] || resolveSchema.call(this, root, ref);
    }
    function resolveSchema(root, ref) {
      const p = this.opts.uriResolver.parse(ref);
      const refPath = (0, resolve_1._getFullPath)(this.opts.uriResolver, p);
      let baseId = (0, resolve_1.getFullPath)(this.opts.uriResolver, root.baseId, void 0);
      if (Object.keys(root.schema).length > 0 && refPath === baseId) {
        return getJsonPointer.call(this, p, root);
      }
      const id = (0, resolve_1.normalizeId)(refPath);
      const schOrRef = this.refs[id] || this.schemas[id];
      if (typeof schOrRef == "string") {
        const sch = resolveSchema.call(this, root, schOrRef);
        if (typeof (sch === null || sch === void 0 ? void 0 : sch.schema) !== "object")
          return;
        return getJsonPointer.call(this, p, sch);
      }
      if (typeof (schOrRef === null || schOrRef === void 0 ? void 0 : schOrRef.schema) !== "object")
        return;
      if (!schOrRef.validate)
        compileSchema.call(this, schOrRef);
      if (id === (0, resolve_1.normalizeId)(ref)) {
        const { schema } = schOrRef;
        const { schemaId } = this.opts;
        const schId = schema[schemaId];
        if (schId)
          baseId = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schId);
        return new SchemaEnv({ schema, schemaId, root, baseId });
      }
      return getJsonPointer.call(this, p, schOrRef);
    }
    exports.resolveSchema = resolveSchema;
    var PREVENT_SCOPE_CHANGE = /* @__PURE__ */ new Set([
      "properties",
      "patternProperties",
      "enum",
      "dependencies",
      "definitions"
    ]);
    function getJsonPointer(parsedRef, { baseId, schema, root }) {
      var _a;
      if (((_a = parsedRef.fragment) === null || _a === void 0 ? void 0 : _a[0]) !== "/")
        return;
      for (const part of parsedRef.fragment.slice(1).split("/")) {
        if (typeof schema === "boolean")
          return;
        const partSchema = schema[(0, util_1.unescapeFragment)(part)];
        if (partSchema === void 0)
          return;
        schema = partSchema;
        const schId = typeof schema === "object" && schema[this.opts.schemaId];
        if (!PREVENT_SCOPE_CHANGE.has(part) && schId) {
          baseId = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schId);
        }
      }
      let env;
      if (typeof schema != "boolean" && schema.$ref && !(0, util_1.schemaHasRulesButRef)(schema, this.RULES)) {
        const $ref = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schema.$ref);
        env = resolveSchema.call(this, root, $ref);
      }
      const { schemaId } = this.opts;
      env = env || new SchemaEnv({ schema, schemaId, root, baseId });
      if (env.schema !== env.root.schema)
        return env;
      return void 0;
    }
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/refs/data.json
var require_data = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/refs/data.json"(exports, module) {
    module.exports = {
      $id: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#",
      description: "Meta-schema for $data reference (JSON AnySchema extension proposal)",
      type: "object",
      required: ["$data"],
      properties: {
        $data: {
          type: "string",
          anyOf: [{ format: "relative-json-pointer" }, { format: "json-pointer" }]
        }
      },
      additionalProperties: false
    };
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/fast-uri/lib/utils.js
var require_utils = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/fast-uri/lib/utils.js"(exports, module) {
    "use strict";
    var isUUID = RegExp.prototype.test.bind(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu);
    var isIPv4 = RegExp.prototype.test.bind(/^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)$/u);
    var isHexPair = RegExp.prototype.test.bind(/^[\da-f]{2}$/iu);
    var isUnreserved = RegExp.prototype.test.bind(/^[\da-z\-._~]$/iu);
    var isPathCharacter = RegExp.prototype.test.bind(/^[A-Za-z0-9\-._~!$&'()*+,;=:@/]$/u);
    var isQueryFragmentCharacter = RegExp.prototype.test.bind(/^[A-Za-z0-9\-._~!$&'()*+,;=:@/?]$/u);
    var isUserinfoCharacter = RegExp.prototype.test.bind(/^[A-Za-z0-9\-._~!$&'()*+,;=:]$/u);
    var BYTE_HEX = new Array(256);
    {
      const HEX_DIGITS = "0123456789ABCDEF";
      for (let i = 0; i < 256; i++) {
        BYTE_HEX[i] = "%" + HEX_DIGITS[i >> 4] + HEX_DIGITS[i & 15];
      }
    }
    function percentEncodeNonAscii(cp) {
      if (cp < 2048) {
        return BYTE_HEX[192 | cp >> 6] + BYTE_HEX[128 | cp & 63];
      }
      if (cp < 65536) {
        return BYTE_HEX[224 | cp >> 12] + BYTE_HEX[128 | cp >> 6 & 63] + BYTE_HEX[128 | cp & 63];
      }
      return BYTE_HEX[240 | cp >> 18] + BYTE_HEX[128 | cp >> 12 & 63] + BYTE_HEX[128 | cp >> 6 & 63] + BYTE_HEX[128 | cp & 63];
    }
    function stringArrayToHexStripped(input) {
      let acc = "";
      let code = 0;
      let i = 0;
      for (i = 0; i < input.length; i++) {
        code = input[i].charCodeAt(0);
        if (code === 48) {
          continue;
        }
        if (!(code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102)) {
          return "";
        }
        acc += input[i];
        break;
      }
      for (i += 1; i < input.length; i++) {
        code = input[i].charCodeAt(0);
        if (!(code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102)) {
          return "";
        }
        acc += input[i];
      }
      return acc;
    }
    var isHextet = RegExp.prototype.test.bind(/^[\dA-Fa-f]{1,4}$/);
    var isIPvFuture = RegExp.prototype.test.bind(/^[vV][\dA-Fa-f]+\.[A-Za-z\d\-._~!$&'()*+,;=:]+$/);
    var isZoneCharacter = RegExp.prototype.test.bind(/^[A-Za-z\d\-._~]$/);
    var nonSimpleDomain = RegExp.prototype.test.bind(/[^!"$&'()*+,\-.;=_`a-z{}~]/u);
    function isZoneIdentifier(zone) {
      if (zone.length === 0) return false;
      for (let i = 0; i < zone.length; i++) {
        if (isZoneCharacter(zone[i])) continue;
        if (zone[i] === "%" && i + 2 < zone.length && isHexPair(zone.slice(i + 1, i + 3))) {
          i += 2;
          continue;
        }
        return false;
      }
      return true;
    }
    function compressIPv6ZeroRun(hextets) {
      let bestStart = -1;
      let bestLength = 0;
      let runStart = -1;
      let runLength = 0;
      for (let i = 0; i < hextets.length; i++) {
        if (hextets[i] === "0") {
          if (runStart === -1) runStart = i;
          runLength++;
          if (runLength > bestLength) {
            bestLength = runLength;
            bestStart = runStart;
          }
        } else {
          runStart = -1;
          runLength = 0;
        }
      }
      if (bestLength < 2) return hextets.join(":");
      const head3 = hextets.slice(0, bestStart).join(":");
      const tail = hextets.slice(bestStart + bestLength).join(":");
      return head3 + "::" + tail;
    }
    function normalizeIPv6Address(input) {
      const compression = input.indexOf("::");
      if (compression !== -1 && input.indexOf("::", compression + 1) !== -1) return void 0;
      const left = compression === -1 ? input.split(":") : input.slice(0, compression).split(":");
      const right = compression === -1 ? [] : input.slice(compression + 2).split(":");
      if (compression !== -1) {
        if (left.length === 1 && left[0] === "") left.length = 0;
        if (right.length === 1 && right[0] === "") right.length = 0;
      }
      const parts = left.concat(right);
      let hextetCount = 0;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part === "") return void 0;
        if (part.indexOf(".") !== -1) {
          if (i !== parts.length - 1 || compression !== -1 && right.length === 0 || !isIPv4(part)) return void 0;
          hextetCount += 2;
          continue;
        }
        if (!isHextet(part)) return void 0;
        parts[i] = parseInt(part, 16).toString(16);
        hextetCount++;
      }
      if (compression === -1) {
        if (hextetCount !== 8) return void 0;
        return compressIPv6ZeroRun(parts);
      }
      if (hextetCount >= 8) return void 0;
      const expanded = parts.slice(0, left.length);
      for (let i = hextetCount; i < 8; i++) expanded.push("0");
      for (let i = left.length; i < parts.length; i++) expanded.push(parts[i]);
      return compressIPv6ZeroRun(expanded);
    }
    function normalizeIPv6(host) {
      const bracketed = host[0] === "[" && host[host.length - 1] === "]";
      const hasBracket = host[0] === "[" || host[host.length - 1] === "]";
      if (hasBracket && !bracketed) return { host, isIPV6: false, error: true };
      let input = bracketed ? host.slice(1, -1) : host;
      if (bracketed && isIPvFuture(input)) {
        input = input.toLowerCase();
        return { host: `[${input}]`, escapedHost: input, isIPV6: false, isIPVFuture: true };
      }
      if (findToken(input, ":") < 2) {
        return { host, isIPV6: false, error: bracketed };
      }
      let zoneIdentifier = "";
      const zoneSeparator = input.indexOf("%");
      if (zoneSeparator !== -1) {
        const separatorLength = input.slice(zoneSeparator, zoneSeparator + 3).toLowerCase() === "%25" ? 3 : 1;
        zoneIdentifier = input.slice(zoneSeparator + separatorLength);
        if (!isZoneIdentifier(zoneIdentifier)) return { host, isIPV6: false, error: true };
        input = input.slice(0, zoneSeparator);
      }
      const address = normalizeIPv6Address(input);
      if (address === void 0) return { host, isIPV6: false, error: true };
      return {
        host: address + (zoneIdentifier ? "%" + zoneIdentifier : ""),
        escapedHost: address + (zoneIdentifier ? "%25" + zoneIdentifier : ""),
        isIPV6: true
      };
    }
    function findToken(str, token) {
      let ind = 0;
      for (let i = 0; i < str.length; i++) {
        if (str[i] === token) ind++;
      }
      return ind;
    }
    function removeDotSegments(path2) {
      let input = path2;
      const output = [];
      let nextSlash = -1;
      let len = 0;
      while (len = input.length) {
        if (len === 1) {
          if (input === ".") {
            break;
          } else if (input === "/") {
            output.push("/");
            break;
          } else {
            output.push(input);
            break;
          }
        } else if (len === 2) {
          if (input[0] === ".") {
            if (input[1] === ".") {
              break;
            } else if (input[1] === "/") {
              input = input.slice(2);
              continue;
            }
          } else if (input[0] === "/") {
            if (input[1] === "." || input[1] === "/") {
              output.push("/");
              break;
            }
          }
        } else if (len === 3) {
          if (input === "/..") {
            if (output.length !== 0) {
              output.pop();
            }
            output.push("/");
            break;
          }
        }
        if (input[0] === ".") {
          if (input[1] === ".") {
            if (input[2] === "/") {
              input = input.slice(3);
              continue;
            }
          } else if (input[1] === "/") {
            input = input.slice(2);
            continue;
          }
        } else if (input[0] === "/") {
          if (input[1] === ".") {
            if (input[2] === "/") {
              input = input.slice(2);
              continue;
            } else if (input[2] === ".") {
              if (input[3] === "/") {
                input = input.slice(3);
                if (output.length !== 0) {
                  output.pop();
                }
                continue;
              }
            }
          }
        }
        if ((nextSlash = input.indexOf("/", 1)) === -1) {
          output.push(input);
          break;
        } else {
          output.push(input.slice(0, nextSlash));
          input = input.slice(nextSlash);
        }
      }
      return output.join("");
    }
    var HOST_DELIMS = { "@": "%40", "/": "%2F", "?": "%3F", "#": "%23", ":": "%3A" };
    var HOST_DELIM_RE = /[@/?#:]/g;
    var HOST_DELIM_NO_COLON_RE = /[@/?#]/g;
    function reescapeHostDelimiters(host, isIP) {
      const re = isIP ? HOST_DELIM_NO_COLON_RE : HOST_DELIM_RE;
      re.lastIndex = 0;
      return host.replace(re, (ch) => HOST_DELIMS[ch]);
    }
    function normalizePercentEncoding(input, decodeUnreserved = false) {
      if (input.indexOf("%") === -1) {
        return input;
      }
      let output = "";
      for (let i = 0; i < input.length; i++) {
        if (input[i] === "%" && i + 2 < input.length) {
          const hex2 = input.slice(i + 1, i + 3);
          if (isHexPair(hex2)) {
            const normalizedHex = hex2.toUpperCase();
            const decoded = String.fromCharCode(parseInt(normalizedHex, 16));
            if (decodeUnreserved && isUnreserved(decoded)) {
              output += decoded;
            } else {
              output += "%" + normalizedHex;
            }
            i += 2;
            continue;
          }
        }
        output += input[i];
      }
      return output;
    }
    function normalizePathEncoding(input) {
      let output = "";
      for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (ch === "%" && i + 2 < input.length) {
          const hex2 = input.slice(i + 1, i + 3);
          if (isHexPair(hex2)) {
            const normalizedHex = hex2.toUpperCase();
            const decoded = String.fromCharCode(parseInt(normalizedHex, 16));
            if (decoded !== "." && isUnreserved(decoded)) {
              output += decoded;
            } else {
              output += "%" + normalizedHex;
            }
            i += 2;
            continue;
          }
        }
        if (isPathCharacter(ch)) {
          output += ch;
        } else {
          const code = input.charCodeAt(i);
          if (code < 128) {
            output += isEscapeSafe(code) ? ch : BYTE_HEX[code];
          } else if (code < 55296 || code > 57343) {
            output += percentEncodeNonAscii(code);
          } else if (code <= 56319 && i + 1 < input.length) {
            const low = input.charCodeAt(i + 1);
            if (low >= 56320 && low <= 57343) {
              output += percentEncodeNonAscii(65536 + (code - 55296 << 10) + (low - 56320));
              i++;
            } else {
              output += percentEncodeNonAscii(65533);
            }
          } else {
            output += percentEncodeNonAscii(65533);
          }
        }
      }
      return output;
    }
    function serializePathEncoding(input, pathNoScheme = false) {
      let output = "";
      let firstSegment = pathNoScheme && input[0] !== "/";
      for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (ch === "%" && i + 2 < input.length) {
          const hex2 = input.slice(i + 1, i + 3);
          if (isHexPair(hex2)) {
            output += "%" + hex2.toUpperCase();
            i += 2;
            continue;
          }
        }
        if (ch === "/") {
          firstSegment = false;
        }
        if (isPathCharacter(ch) && (ch !== ":" || !firstSegment)) {
          output += ch;
        } else {
          const code = input.charCodeAt(i);
          if (code < 128) {
            output += BYTE_HEX[code];
          } else if (code < 55296 || code > 57343) {
            output += percentEncodeNonAscii(code);
          } else if (code <= 56319 && i + 1 < input.length) {
            const low = input.charCodeAt(i + 1);
            if (low >= 56320 && low <= 57343) {
              output += percentEncodeNonAscii(65536 + (code - 55296 << 10) + (low - 56320));
              i++;
            } else {
              output += percentEncodeNonAscii(65533);
            }
          } else {
            output += percentEncodeNonAscii(65533);
          }
        }
      }
      return output;
    }
    function encodeComponent(input, isAllowed) {
      let output = "";
      for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (ch === "%" && i + 2 < input.length) {
          const hex2 = input.slice(i + 1, i + 3);
          if (isHexPair(hex2)) {
            output += "%" + hex2.toUpperCase();
            i += 2;
            continue;
          }
        }
        if (isAllowed(ch)) {
          output += ch;
        } else {
          const code = input.charCodeAt(i);
          if (code < 128) {
            output += BYTE_HEX[code];
          } else if (code < 55296 || code > 57343) {
            output += percentEncodeNonAscii(code);
          } else if (code <= 56319 && i + 1 < input.length) {
            const low = input.charCodeAt(i + 1);
            if (low >= 56320 && low <= 57343) {
              output += percentEncodeNonAscii(65536 + (code - 55296 << 10) + (low - 56320));
              i++;
            } else {
              output += percentEncodeNonAscii(65533);
            }
          } else {
            output += percentEncodeNonAscii(65533);
          }
        }
      }
      return output;
    }
    function encodeUserinfo(input) {
      return encodeComponent(input, isUserinfoCharacter);
    }
    function encodeQuery(input) {
      return encodeComponent(input, isQueryFragmentCharacter);
    }
    function encodeFragment(input) {
      return encodeComponent(input, isQueryFragmentCharacter);
    }
    function isEscapeSafe(cp) {
      return cp >= 48 && cp <= 57 || cp >= 65 && cp <= 90 || cp >= 97 && cp <= 122 || cp === 42 || cp === 43 || cp === 45 || cp === 46 || cp === 47 || cp === 64 || cp === 95;
    }
    function normalizeQueryFragmentEncoding(input) {
      let output = "";
      for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (ch === "%" && i + 2 < input.length) {
          const hex2 = input.slice(i + 1, i + 3);
          if (isHexPair(hex2)) {
            const normalizedHex = hex2.toUpperCase();
            const decoded = String.fromCharCode(parseInt(normalizedHex, 16));
            if (isUnreserved(decoded)) {
              output += decoded;
            } else {
              output += "%" + normalizedHex;
            }
            i += 2;
            continue;
          }
        }
        if (isQueryFragmentCharacter(ch)) {
          output += ch;
        } else {
          const code = input.charCodeAt(i);
          if (code < 128) {
            output += isEscapeSafe(code) ? ch : BYTE_HEX[code];
          } else if (code < 55296 || code > 57343) {
            output += percentEncodeNonAscii(code);
          } else if (code <= 56319 && i + 1 < input.length) {
            const low = input.charCodeAt(i + 1);
            if (low >= 56320 && low <= 57343) {
              output += percentEncodeNonAscii(65536 + (code - 55296 << 10) + (low - 56320));
              i++;
            } else {
              output += percentEncodeNonAscii(65533);
            }
          } else {
            output += percentEncodeNonAscii(65533);
          }
        }
      }
      return output;
    }
    function escapePreservingEscapes(input) {
      let output = "";
      for (let i = 0; i < input.length; i++) {
        if (input[i] === "%" && i + 2 < input.length) {
          const hex2 = input.slice(i + 1, i + 3);
          if (isHexPair(hex2)) {
            output += "%" + hex2.toUpperCase();
            i += 2;
            continue;
          }
        }
        output += escape(input[i]);
      }
      return output;
    }
    function recomposeAuthority(component) {
      const uriTokens = [];
      if (component.userinfo !== void 0) {
        uriTokens.push(encodeUserinfo(component.userinfo));
        uriTokens.push("@");
      }
      if (component.host !== void 0) {
        let host = component.host;
        if (!isIPv4(host)) {
          let ipV6res = normalizeIPv6(host);
          if (ipV6res.isIPV6 !== true && ipV6res.isIPVFuture !== true) {
            host = normalizePercentEncoding(host, true);
            ipV6res = normalizeIPv6(host);
          }
          if (ipV6res.isIPV6 === true || ipV6res.isIPVFuture === true) {
            host = `[${ipV6res.escapedHost}]`;
          } else {
            host = reescapeHostDelimiters(host, false);
          }
        }
        uriTokens.push(host);
      }
      if (typeof component.port === "number" || typeof component.port === "string") {
        uriTokens.push(":");
        uriTokens.push(String(component.port));
      }
      return uriTokens.length ? uriTokens.join("") : void 0;
    }
    module.exports = {
      nonSimpleDomain,
      recomposeAuthority,
      reescapeHostDelimiters,
      normalizePercentEncoding,
      normalizePathEncoding,
      serializePathEncoding,
      normalizeQueryFragmentEncoding,
      encodeUserinfo,
      encodeQuery,
      encodeFragment,
      escapePreservingEscapes,
      removeDotSegments,
      isIPv4,
      isUUID,
      normalizeIPv6,
      stringArrayToHexStripped
    };
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/fast-uri/lib/schemes.js
var require_schemes = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/fast-uri/lib/schemes.js"(exports, module) {
    "use strict";
    var { isUUID } = require_utils();
    var URN_REG = /^([\da-z][\d\-a-z]{0,31}):((?:[\w!$'()*+,\-./:;=@]|%[\da-f]{2})+)$/iu;
    var supportedSchemeNames = (
      /** @type {const} */
      [
        "http",
        "https",
        "ws",
        "wss",
        "urn",
        "urn:uuid"
      ]
    );
    function isValidSchemeName(name) {
      return supportedSchemeNames.indexOf(
        /** @type {*} */
        name
      ) !== -1;
    }
    function wsIsSecure(wsComponent) {
      if (wsComponent.secure === true) {
        return true;
      } else if (wsComponent.secure === false) {
        return false;
      } else if (wsComponent.scheme) {
        return wsComponent.scheme.length === 3 && (wsComponent.scheme[0] === "w" || wsComponent.scheme[0] === "W") && (wsComponent.scheme[1] === "s" || wsComponent.scheme[1] === "S") && (wsComponent.scheme[2] === "s" || wsComponent.scheme[2] === "S");
      } else {
        return false;
      }
    }
    function httpParse(component) {
      if (!component.host) {
        component.error = component.error || "HTTP URIs must have a host.";
      }
      return component;
    }
    function httpSerialize(component) {
      const secure = String(component.scheme).toLowerCase() === "https";
      if (component.port === (secure ? 443 : 80) || component.port === "") {
        component.port = void 0;
      }
      if (!component.path) {
        component.path = "/";
      }
      return component;
    }
    function wsParse(wsComponent) {
      wsComponent.secure = wsIsSecure(wsComponent);
      wsComponent.resourceName = (wsComponent.path || "/") + (wsComponent.query ? "?" + wsComponent.query : "");
      wsComponent.path = void 0;
      wsComponent.query = void 0;
      return wsComponent;
    }
    function wsSerialize(wsComponent) {
      if (wsComponent.port === (wsIsSecure(wsComponent) ? 443 : 80) || wsComponent.port === "") {
        wsComponent.port = void 0;
      }
      if (typeof wsComponent.secure === "boolean") {
        wsComponent.scheme = wsComponent.secure ? "wss" : "ws";
        wsComponent.secure = void 0;
      }
      if (wsComponent.resourceName) {
        const queryIndex = wsComponent.resourceName.indexOf("?");
        const path2 = queryIndex === -1 ? wsComponent.resourceName : wsComponent.resourceName.slice(0, queryIndex);
        wsComponent.path = path2 && path2 !== "/" ? path2 : void 0;
        wsComponent.query = queryIndex === -1 ? void 0 : wsComponent.resourceName.slice(queryIndex + 1);
        wsComponent.resourceName = void 0;
      }
      wsComponent.fragment = void 0;
      return wsComponent;
    }
    function urnParse(urnComponent, options) {
      if (!urnComponent.path) {
        urnComponent.error = "URN can not be parsed";
        return urnComponent;
      }
      const matches = urnComponent.path.match(URN_REG);
      if (matches && matches[0] === urnComponent.path) {
        const scheme = options.scheme || urnComponent.scheme || "urn";
        urnComponent.nid = matches[1].toLowerCase();
        urnComponent.nss = matches[2];
        const urnScheme = `${scheme}:${options.nid || urnComponent.nid}`;
        const schemeHandler = getSchemeHandler(urnScheme);
        urnComponent.path = void 0;
        if (schemeHandler) {
          urnComponent = schemeHandler.parse(urnComponent, options);
        }
      } else {
        urnComponent.error = urnComponent.error || "URN can not be parsed.";
      }
      return urnComponent;
    }
    function urnSerialize(urnComponent, options) {
      if (urnComponent.nid === void 0) {
        throw new Error("URN without nid cannot be serialized");
      }
      const scheme = options.scheme || urnComponent.scheme || "urn";
      const nid = urnComponent.nid.toLowerCase();
      const urnScheme = `${scheme}:${options.nid || nid}`;
      const schemeHandler = getSchemeHandler(urnScheme);
      if (schemeHandler) {
        urnComponent = schemeHandler.serialize(urnComponent, options);
      }
      const uriComponent = urnComponent;
      const nss = urnComponent.nss;
      uriComponent.path = `${nid || options.nid}:${nss}`;
      options.skipEscape = true;
      return uriComponent;
    }
    function urnuuidParse(urnComponent, options) {
      const uuidComponent = urnComponent;
      uuidComponent.uuid = uuidComponent.nss;
      uuidComponent.nss = void 0;
      if (!options.tolerant && (!uuidComponent.uuid || !isUUID(uuidComponent.uuid))) {
        uuidComponent.error = uuidComponent.error || "UUID is not valid.";
      }
      return uuidComponent;
    }
    function urnuuidSerialize(uuidComponent) {
      const urnComponent = uuidComponent;
      urnComponent.nss = (uuidComponent.uuid || "").toLowerCase();
      return urnComponent;
    }
    var http = (
      /** @type {SchemeHandler} */
      {
        scheme: "http",
        domainHost: true,
        parse: httpParse,
        serialize: httpSerialize
      }
    );
    var https = (
      /** @type {SchemeHandler} */
      {
        scheme: "https",
        domainHost: http.domainHost,
        parse: httpParse,
        serialize: httpSerialize
      }
    );
    var ws = (
      /** @type {SchemeHandler} */
      {
        scheme: "ws",
        domainHost: true,
        parse: wsParse,
        serialize: wsSerialize
      }
    );
    var wss = (
      /** @type {SchemeHandler} */
      {
        scheme: "wss",
        domainHost: ws.domainHost,
        parse: ws.parse,
        serialize: ws.serialize
      }
    );
    var urn = (
      /** @type {SchemeHandler} */
      {
        scheme: "urn",
        parse: urnParse,
        serialize: urnSerialize,
        skipNormalize: true
      }
    );
    var urnuuid = (
      /** @type {SchemeHandler} */
      {
        scheme: "urn:uuid",
        parse: urnuuidParse,
        serialize: urnuuidSerialize,
        skipNormalize: true
      }
    );
    var SCHEMES = (
      /** @type {Record<SchemeName, SchemeHandler>} */
      {
        http,
        https,
        ws,
        wss,
        urn,
        "urn:uuid": urnuuid
      }
    );
    Object.setPrototypeOf(SCHEMES, null);
    function getSchemeHandler(scheme) {
      return scheme && (SCHEMES[
        /** @type {SchemeName} */
        scheme
      ] || SCHEMES[
        /** @type {SchemeName} */
        scheme.toLowerCase()
      ]) || void 0;
    }
    module.exports = {
      wsIsSecure,
      SCHEMES,
      isValidSchemeName,
      getSchemeHandler
    };
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/fast-uri/index.js
var require_fast_uri = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/fast-uri/index.js"(exports, module) {
    "use strict";
    var { normalizeIPv6, removeDotSegments, recomposeAuthority, normalizePercentEncoding, normalizePathEncoding, serializePathEncoding, normalizeQueryFragmentEncoding, encodeQuery, encodeFragment, reescapeHostDelimiters, isIPv4, nonSimpleDomain } = require_utils();
    var { SCHEMES, getSchemeHandler } = require_schemes();
    var VALID_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*$/u;
    var MALFORMED_SCHEME_ERROR = "URI scheme is malformed.";
    function decodeValidScheme(scheme) {
      const decodedScheme = unescape(String(scheme));
      if (!VALID_SCHEME.test(decodedScheme)) {
        throw new TypeError(MALFORMED_SCHEME_ERROR);
      }
      return decodedScheme;
    }
    function normalize5(uri, options) {
      if (typeof uri === "string") {
        uri = /** @type {T} */
        normalizeString2(uri, options);
      } else if (typeof uri === "object") {
        uri = /** @type {T} */
        parse(serialize(uri, options), options);
      }
      return uri;
    }
    function resolve5(baseURI, relativeURI, options) {
      const schemelessOptions = options ? Object.assign({ scheme: "null" }, options) : { scheme: "null" };
      const {
        parsed: baseParsed,
        malformedAuthorityOrPort: baseMalformed,
        malformedPercentEncoding: baseMalformedPercentEncoding,
        malformedSchemeSpecific: baseMalformedSchemeSpecific,
        malformedHost: baseMalformedHost,
        malformedScheme: baseMalformedScheme
      } = parseWithStatus(baseURI, schemelessOptions);
      const {
        parsed: relativeParsed,
        malformedAuthorityOrPort: relativeMalformed,
        malformedPercentEncoding: relativeMalformedPercentEncoding,
        malformedSchemeSpecific: relativeMalformedSchemeSpecific,
        malformedHost: relativeMalformedHost,
        malformedScheme: relativeMalformedScheme
      } = parseWithStatus(relativeURI, schemelessOptions);
      if (baseMalformed || relativeMalformed || baseMalformedPercentEncoding || relativeMalformedPercentEncoding || baseMalformedSchemeSpecific || relativeMalformedSchemeSpecific || baseMalformedHost || relativeMalformedHost || baseMalformedScheme || relativeMalformedScheme) {
        throw new Error(baseParsed.error || relativeParsed.error || "URI is malformed.");
      }
      const resolved = resolveComponent(baseParsed, relativeParsed, schemelessOptions, true);
      const resolvedSchemeHandler = getSchemeHandler(options && options.scheme || resolved.scheme);
      const resolvedHost = resolved.host;
      const resolvedHostIsIP = resolvedHost !== void 0 && resolvedHost !== "" && (isIPv4(resolvedHost) || normalizeIPv6(resolvedHost).isIPV6);
      canonicalizeHost(resolved, options || {}, resolvedSchemeHandler, resolvedHostIsIP);
      const encodedASCIIHost = resolvedHost && resolvedHost.indexOf("%") !== -1 && !new RegExp("\\P{ASCII}", "u").test(resolvedHost);
      if (resolved.error && !encodedASCIIHost) {
        throw new Error(resolved.error);
      }
      schemelessOptions.skipEscape = true;
      return serialize(resolved, schemelessOptions);
    }
    function resolveComponent(base, relative2, options, skipNormalization) {
      const target = {};
      if (!skipNormalization) {
        base = parse(serialize(base, options), options);
        relative2 = parse(serialize(relative2, options), options);
      }
      options = options || {};
      if (!options.tolerant && relative2.scheme) {
        target.scheme = relative2.scheme;
        target.userinfo = relative2.userinfo;
        target.host = relative2.host;
        target.port = relative2.port;
        target.path = removeDotSegments(relative2.path || "");
        target.query = relative2.query;
      } else {
        if (relative2.userinfo !== void 0 || relative2.host !== void 0 || relative2.port !== void 0) {
          target.userinfo = relative2.userinfo;
          target.host = relative2.host;
          target.port = relative2.port;
          target.path = removeDotSegments(relative2.path || "");
          target.query = relative2.query;
        } else {
          if (!relative2.path) {
            target.path = base.path;
            if (relative2.query !== void 0) {
              target.query = relative2.query;
            } else {
              target.query = base.query;
            }
          } else {
            if (relative2.path[0] === "/") {
              target.path = removeDotSegments(relative2.path);
            } else {
              if ((base.userinfo !== void 0 || base.host !== void 0 || base.port !== void 0) && !base.path) {
                target.path = "/" + relative2.path;
              } else if (!base.path) {
                target.path = relative2.path;
              } else {
                target.path = base.path.slice(0, base.path.lastIndexOf("/") + 1) + relative2.path;
              }
              target.path = removeDotSegments(target.path);
            }
            target.query = relative2.query;
          }
          target.userinfo = base.userinfo;
          target.host = base.host;
          target.port = base.port;
        }
        target.scheme = base.scheme;
      }
      target.fragment = relative2.fragment;
      return target;
    }
    function equal2(uriA, uriB, options) {
      const normalizedA = normalizeComparableURI(uriA, options);
      const normalizedB = normalizeComparableURI(uriB, options);
      return normalizedA !== void 0 && normalizedB !== void 0 && normalizedA === normalizedB;
    }
    function serialize(cmpts, opts) {
      const component = {
        host: cmpts.host,
        scheme: cmpts.scheme,
        userinfo: cmpts.userinfo,
        port: cmpts.port,
        path: cmpts.path,
        query: cmpts.query,
        nid: cmpts.nid,
        nss: cmpts.nss,
        uuid: cmpts.uuid,
        fragment: cmpts.fragment,
        reference: cmpts.reference,
        resourceName: cmpts.resourceName,
        secure: cmpts.secure,
        error: ""
      };
      const options = Object.assign({}, opts);
      const uriTokens = [];
      if (component.scheme) {
        component.scheme = decodeValidScheme(component.scheme);
      }
      const schemeHandler = getSchemeHandler(options.scheme || component.scheme);
      if (schemeHandler && schemeHandler.serialize) schemeHandler.serialize(component, options);
      const hasAuthority = component.userinfo !== void 0 || component.host !== void 0 || component.port !== void 0;
      const pathNoScheme = !options.skipEscape && component.scheme === void 0 && !hasAuthority;
      if (component.path !== void 0) {
        if (!options.skipEscape) {
          component.path = serializePathEncoding(component.path, pathNoScheme);
        } else {
          component.path = normalizePercentEncoding(component.path);
        }
      }
      if (options.reference !== "suffix" && component.scheme) {
        component.scheme = decodeValidScheme(component.scheme);
        uriTokens.push(component.scheme, ":");
      }
      const authority = recomposeAuthority(component);
      if (authority !== void 0) {
        if (options.reference !== "suffix") {
          uriTokens.push("//");
        }
        uriTokens.push(authority);
        if (component.path && component.path[0] !== "/") {
          uriTokens.push("/");
        }
      }
      if (component.path !== void 0) {
        let s = component.path;
        if (!options.absolutePath && (!schemeHandler || !schemeHandler.absolutePath)) {
          s = removeDotSegments(s);
        }
        if (pathNoScheme) {
          s = serializePathEncoding(s, true);
        }
        if (authority === void 0 && s[0] === "/" && s[1] === "/") {
          s = "/%2F" + s.slice(2);
        }
        uriTokens.push(s);
      }
      if (component.query !== void 0) {
        uriTokens.push("?", encodeQuery(component.query));
      }
      if (component.fragment !== void 0) {
        uriTokens.push("#", encodeFragment(component.fragment));
      }
      return uriTokens.join("");
    }
    var URI_PARSE = /^(?:([^#/:?]+):)?(?:\/\/((?:([^#/?@]*)@)?(\[[^#/?\]]+\]|[^#/:?]*)(?::(\d*))?))?([^#?]*)(?:\?([^#]*))?(?:#((?:.|[\n\r])*))?/u;
    var AUTHORITY_PREFIX = /^(?:[^#/:?]+:)?\/\/([^/?#]*)/;
    var AUTHORITY_INTRODUCER_REGION = /^(?:[^#/:?]+:)?([/\\\t\n\r]*)/;
    function getParseError(parsed, matches) {
      if (matches[2] !== void 0 && parsed.path && parsed.path[0] !== "/") {
        return 'URI path must start with "/" when authority is present.';
      }
      if (typeof parsed.port === "number" && (parsed.port < 0 || parsed.port > 65535)) {
        return "URI port is malformed.";
      }
      return void 0;
    }
    function hasMalformedPercentEncoding(component) {
      if (component === void 0) return false;
      let percent = component.indexOf("%");
      while (percent !== -1) {
        if (percent + 2 >= component.length || !/^[\da-f]{2}$/iu.test(component.slice(percent + 1, percent + 3))) {
          return true;
        }
        percent = component.indexOf("%", percent + 3);
      }
      return false;
    }
    function hasMalformedComponentPercentEncoding(matches) {
      const host = matches[4];
      return hasMalformedPercentEncoding(matches[3]) || host !== void 0 && !(host[0] === "[" && host[host.length - 1] === "]") && hasMalformedPercentEncoding(host) || hasMalformedPercentEncoding(matches[6]) || hasMalformedPercentEncoding(matches[7]) || hasMalformedPercentEncoding(matches[8]);
    }
    function canonicalizeHost(parsed, options, schemeHandler, isIP) {
      if (!options.unicodeSupport && (!schemeHandler || !schemeHandler.unicodeSupport) && parsed.host && parsed.host[0] !== "[" && (options.domainHost || schemeHandler && schemeHandler.domainHost) && isIP === false && nonSimpleDomain(parsed.host)) {
        try {
          parsed.host = new URL("http://" + parsed.host).hostname;
        } catch (e) {
          parsed.error = parsed.error || "Host's domain name can not be converted to ASCII: " + e;
          return true;
        }
      }
      return false;
    }
    function parseWithStatus(uri, opts) {
      const options = Object.assign({}, opts);
      const parsed = {
        scheme: void 0,
        userinfo: void 0,
        host: "",
        port: void 0,
        path: "",
        query: void 0,
        fragment: void 0
      };
      let malformedAuthorityOrPort = false;
      let malformedPercentEncoding = false;
      let malformedSchemeSpecific = false;
      let malformedHost = false;
      let malformedIPLiteral = false;
      let malformedScheme = false;
      let isIP = false;
      if (options.reference === "suffix") {
        if (options.scheme) {
          uri = options.scheme + ":" + uri;
        } else {
          uri = "//" + uri;
        }
      }
      const authorityMatch = uri.match(AUTHORITY_PREFIX);
      if (authorityMatch !== null && authorityMatch[1].indexOf("\\") !== -1) {
        parsed.error = "URI authority must not contain a literal backslash.";
        malformedAuthorityOrPort = true;
      }
      const introducerMatch = uri.match(AUTHORITY_INTRODUCER_REGION);
      if (introducerMatch !== null) {
        const region = introducerMatch[1];
        const normalizedRegion = region.replace(/[\t\n\r]/g, "");
        if (normalizedRegion.length >= 2) {
          if (normalizedRegion.slice(0, 2) !== "//") {
            parsed.error = parsed.error || "URI authority must not contain a literal backslash.";
            malformedAuthorityOrPort = true;
          } else if (region.length !== normalizedRegion.length) {
            parsed.error = parsed.error || "URI authority introducer must not contain whitespace.";
            malformedAuthorityOrPort = true;
          }
        }
      }
      const matches = uri.match(URI_PARSE);
      if (matches) {
        parsed.scheme = matches[1];
        parsed.userinfo = matches[3];
        parsed.host = matches[4];
        parsed.port = parseInt(matches[5], 10);
        parsed.path = matches[6] || "";
        parsed.query = matches[7];
        parsed.fragment = matches[8];
        if (parsed.scheme !== void 0) {
          const decodedScheme = unescape(parsed.scheme);
          if (VALID_SCHEME.test(decodedScheme)) {
            parsed.scheme = decodedScheme.toLowerCase();
          } else {
            parsed.error = parsed.error || MALFORMED_SCHEME_ERROR;
            malformedScheme = true;
          }
        }
        malformedPercentEncoding = hasMalformedComponentPercentEncoding(matches);
        if (malformedPercentEncoding) {
          parsed.error = parsed.error || "URI contains malformed percent-encoding.";
        }
        if (isNaN(parsed.port)) {
          parsed.port = matches[5];
        }
        const parseError = getParseError(parsed, matches);
        if (parseError !== void 0) {
          parsed.error = parsed.error || parseError;
          malformedAuthorityOrPort = true;
        }
        if (parsed.host) {
          const ipv4result = isIPv4(parsed.host);
          if (ipv4result === false) {
            const bracketedIPLiteral = parsed.host[0] === "[" && parsed.host[parsed.host.length - 1] === "]";
            const ipv6result = normalizeIPv6(parsed.host);
            isIP = ipv6result.isIPV6 || ipv6result.isIPVFuture === true;
            malformedIPLiteral = bracketedIPLiteral && ipv6result.error === true;
            parsed.host = isIP ? ipv6result.host : ipv6result.host.toLowerCase();
            if (malformedIPLiteral) {
              parsed.error = parsed.error || "URI host is malformed.";
              malformedAuthorityOrPort = true;
            }
          } else {
            isIP = true;
          }
        }
        if (parsed.scheme === void 0 && parsed.userinfo === void 0 && parsed.host === void 0 && parsed.port === void 0 && parsed.query === void 0 && !parsed.path) {
          parsed.reference = "same-document";
        } else if (parsed.scheme === void 0) {
          parsed.reference = "relative";
        } else if (parsed.fragment === void 0) {
          parsed.reference = "absolute";
        } else {
          parsed.reference = "uri";
        }
        if (options.reference && options.reference !== "suffix" && options.reference !== parsed.reference) {
          parsed.error = parsed.error || "URI is not a " + options.reference + " reference.";
        }
        const schemeHandler = getSchemeHandler(options.scheme || parsed.scheme);
        malformedHost = canonicalizeHost(parsed, options, schemeHandler, isIP);
        if (!schemeHandler || schemeHandler && !schemeHandler.skipNormalize) {
          if (uri.indexOf("%") !== -1) {
            if (parsed.host !== void 0 && !malformedIPLiteral) {
              const host = isIP ? parsed.host : normalizePercentEncoding(parsed.host, true);
              parsed.host = reescapeHostDelimiters(host, isIP);
            }
          }
          if (parsed.path) {
            parsed.path = normalizePathEncoding(parsed.path);
          }
          if (parsed.query) {
            parsed.query = normalizeQueryFragmentEncoding(parsed.query);
          }
          if (parsed.fragment) {
            parsed.fragment = normalizeQueryFragmentEncoding(parsed.fragment);
          }
        }
        if (schemeHandler && schemeHandler.parse) {
          schemeHandler.parse(parsed, options);
          if (schemeHandler === SCHEMES.urn && parsed.nid === void 0) {
            malformedSchemeSpecific = true;
          }
        }
      } else {
        parsed.error = parsed.error || "URI can not be parsed.";
      }
      return { parsed, malformedAuthorityOrPort, malformedPercentEncoding, malformedSchemeSpecific, malformedHost, malformedScheme };
    }
    function parse(uri, opts) {
      return parseWithStatus(uri, opts).parsed;
    }
    function normalizeString2(uri, opts) {
      return normalizeStringWithStatus(uri, opts).normalized;
    }
    function normalizeStringWithStatus(uri, opts) {
      const { parsed, malformedAuthorityOrPort, malformedPercentEncoding, malformedSchemeSpecific, malformedHost, malformedScheme } = parseWithStatus(uri, opts);
      return {
        normalized: malformedAuthorityOrPort || malformedPercentEncoding || malformedSchemeSpecific || malformedHost || malformedScheme ? uri : serialize(parsed, opts),
        malformedAuthorityOrPort,
        malformedPercentEncoding,
        malformedSchemeSpecific,
        malformedHost,
        malformedScheme
      };
    }
    function normalizeComparableURI(uri, opts) {
      if (typeof uri !== "string" && typeof uri !== "object") {
        return void 0;
      }
      let value;
      try {
        value = typeof uri === "string" ? uri : serialize(uri, opts);
      } catch {
        return void 0;
      }
      const { normalized, malformedAuthorityOrPort, malformedPercentEncoding, malformedSchemeSpecific, malformedHost, malformedScheme } = normalizeStringWithStatus(value, opts);
      return malformedAuthorityOrPort || malformedPercentEncoding || malformedSchemeSpecific || malformedHost || malformedScheme ? void 0 : normalized;
    }
    var fastUri = {
      SCHEMES,
      normalize: normalize5,
      resolve: resolve5,
      resolveComponent,
      equal: equal2,
      serialize,
      parse
    };
    module.exports = fastUri;
    module.exports.default = fastUri;
    module.exports.fastUri = fastUri;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/runtime/uri.js
var require_uri = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/runtime/uri.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var uri = require_fast_uri();
    uri.code = 'require("ajv/dist/runtime/uri").default';
    exports.default = uri;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/core.js
var require_core = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/core.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.CodeGen = exports.Name = exports.nil = exports.stringify = exports.str = exports._ = exports.KeywordCxt = void 0;
    var validate_1 = require_validate();
    Object.defineProperty(exports, "KeywordCxt", { enumerable: true, get: function() {
      return validate_1.KeywordCxt;
    } });
    var codegen_1 = require_codegen();
    Object.defineProperty(exports, "_", { enumerable: true, get: function() {
      return codegen_1._;
    } });
    Object.defineProperty(exports, "str", { enumerable: true, get: function() {
      return codegen_1.str;
    } });
    Object.defineProperty(exports, "stringify", { enumerable: true, get: function() {
      return codegen_1.stringify;
    } });
    Object.defineProperty(exports, "nil", { enumerable: true, get: function() {
      return codegen_1.nil;
    } });
    Object.defineProperty(exports, "Name", { enumerable: true, get: function() {
      return codegen_1.Name;
    } });
    Object.defineProperty(exports, "CodeGen", { enumerable: true, get: function() {
      return codegen_1.CodeGen;
    } });
    var validation_error_1 = require_validation_error();
    var ref_error_1 = require_ref_error();
    var rules_1 = require_rules();
    var compile_1 = require_compile();
    var codegen_2 = require_codegen();
    var resolve_1 = require_resolve();
    var dataType_1 = require_dataType();
    var util_1 = require_util();
    var $dataRefSchema = require_data();
    var uri_1 = require_uri();
    var defaultRegExp = (str, flags) => new RegExp(str, flags);
    defaultRegExp.code = "new RegExp";
    var META_IGNORE_OPTIONS = ["removeAdditional", "useDefaults", "coerceTypes"];
    var EXT_SCOPE_NAMES = /* @__PURE__ */ new Set([
      "validate",
      "serialize",
      "parse",
      "wrapper",
      "root",
      "schema",
      "keyword",
      "pattern",
      "formats",
      "validate$data",
      "func",
      "obj",
      "Error"
    ]);
    var removedOptions = {
      errorDataPath: "",
      format: "`validateFormats: false` can be used instead.",
      nullable: '"nullable" keyword is supported by default.',
      jsonPointers: "Deprecated jsPropertySyntax can be used instead.",
      extendRefs: "Deprecated ignoreKeywordsWithRef can be used instead.",
      missingRefs: "Pass empty schema with $id that should be ignored to ajv.addSchema.",
      processCode: "Use option `code: {process: (code, schemaEnv: object) => string}`",
      sourceCode: "Use option `code: {source: true}`",
      strictDefaults: "It is default now, see option `strict`.",
      strictKeywords: "It is default now, see option `strict`.",
      uniqueItems: '"uniqueItems" keyword is always validated.',
      unknownFormats: "Disable strict mode or pass `true` to `ajv.addFormat` (or `formats` option).",
      cache: "Map is used as cache, schema object as key.",
      serialize: "Map is used as cache, schema object as key.",
      ajvErrors: "It is default now."
    };
    var deprecatedOptions = {
      ignoreKeywordsWithRef: "",
      jsPropertySyntax: "",
      unicode: '"minLength"/"maxLength" account for unicode characters by default.'
    };
    var MAX_EXPRESSION = 200;
    function requiredOptions(o) {
      var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0;
      const s = o.strict;
      const _optz = (_a = o.code) === null || _a === void 0 ? void 0 : _a.optimize;
      const optimize = _optz === true || _optz === void 0 ? 1 : _optz || 0;
      const regExp = (_c = (_b = o.code) === null || _b === void 0 ? void 0 : _b.regExp) !== null && _c !== void 0 ? _c : defaultRegExp;
      const uriResolver = (_d = o.uriResolver) !== null && _d !== void 0 ? _d : uri_1.default;
      return {
        strictSchema: (_f = (_e = o.strictSchema) !== null && _e !== void 0 ? _e : s) !== null && _f !== void 0 ? _f : true,
        strictNumbers: (_h = (_g = o.strictNumbers) !== null && _g !== void 0 ? _g : s) !== null && _h !== void 0 ? _h : true,
        strictTypes: (_k = (_j = o.strictTypes) !== null && _j !== void 0 ? _j : s) !== null && _k !== void 0 ? _k : "log",
        strictTuples: (_m = (_l = o.strictTuples) !== null && _l !== void 0 ? _l : s) !== null && _m !== void 0 ? _m : "log",
        strictRequired: (_p = (_o = o.strictRequired) !== null && _o !== void 0 ? _o : s) !== null && _p !== void 0 ? _p : false,
        code: o.code ? { ...o.code, optimize, regExp } : { optimize, regExp },
        loopRequired: (_q = o.loopRequired) !== null && _q !== void 0 ? _q : MAX_EXPRESSION,
        loopEnum: (_r = o.loopEnum) !== null && _r !== void 0 ? _r : MAX_EXPRESSION,
        meta: (_s = o.meta) !== null && _s !== void 0 ? _s : true,
        messages: (_t = o.messages) !== null && _t !== void 0 ? _t : true,
        inlineRefs: (_u = o.inlineRefs) !== null && _u !== void 0 ? _u : true,
        schemaId: (_v = o.schemaId) !== null && _v !== void 0 ? _v : "$id",
        addUsedSchema: (_w = o.addUsedSchema) !== null && _w !== void 0 ? _w : true,
        validateSchema: (_x = o.validateSchema) !== null && _x !== void 0 ? _x : true,
        validateFormats: (_y = o.validateFormats) !== null && _y !== void 0 ? _y : true,
        unicodeRegExp: (_z = o.unicodeRegExp) !== null && _z !== void 0 ? _z : true,
        int32range: (_0 = o.int32range) !== null && _0 !== void 0 ? _0 : true,
        uriResolver
      };
    }
    var Ajv5 = class {
      constructor(opts = {}) {
        this.schemas = {};
        this.refs = {};
        this.formats = /* @__PURE__ */ Object.create(null);
        this._compilations = /* @__PURE__ */ new Set();
        this._loading = {};
        this._cache = /* @__PURE__ */ new Map();
        opts = this.opts = { ...opts, ...requiredOptions(opts) };
        const { es5, lines: lines2 } = this.opts.code;
        this.scope = new codegen_2.ValueScope({ scope: {}, prefixes: EXT_SCOPE_NAMES, es5, lines: lines2 });
        this.logger = getLogger(opts.logger);
        const formatOpt = opts.validateFormats;
        opts.validateFormats = false;
        this.RULES = (0, rules_1.getRules)();
        checkOptions.call(this, removedOptions, opts, "NOT SUPPORTED");
        checkOptions.call(this, deprecatedOptions, opts, "DEPRECATED", "warn");
        this._metaOpts = getMetaSchemaOptions.call(this);
        if (opts.formats)
          addInitialFormats.call(this);
        this._addVocabularies();
        this._addDefaultMetaSchema();
        if (opts.keywords)
          addInitialKeywords.call(this, opts.keywords);
        if (typeof opts.meta == "object")
          this.addMetaSchema(opts.meta);
        addInitialSchemas.call(this);
        opts.validateFormats = formatOpt;
      }
      _addVocabularies() {
        this.addKeyword("$async");
      }
      _addDefaultMetaSchema() {
        const { $data, meta, schemaId } = this.opts;
        let _dataRefSchema = $dataRefSchema;
        if (schemaId === "id") {
          _dataRefSchema = { ...$dataRefSchema };
          _dataRefSchema.id = _dataRefSchema.$id;
          delete _dataRefSchema.$id;
        }
        if (meta && $data)
          this.addMetaSchema(_dataRefSchema, _dataRefSchema[schemaId], false);
      }
      defaultMeta() {
        const { meta, schemaId } = this.opts;
        return this.opts.defaultMeta = typeof meta == "object" ? meta[schemaId] || meta : void 0;
      }
      validate(schemaKeyRef, data) {
        let v;
        if (typeof schemaKeyRef == "string") {
          v = this.getSchema(schemaKeyRef);
          if (!v)
            throw new Error(`no schema with key or ref "${schemaKeyRef}"`);
        } else {
          v = this.compile(schemaKeyRef);
        }
        const valid = v(data);
        if (!("$async" in v))
          this.errors = v.errors;
        return valid;
      }
      compile(schema, _meta) {
        const sch = this._addSchema(schema, _meta);
        return sch.validate || this._compileSchemaEnv(sch);
      }
      compileAsync(schema, meta) {
        if (typeof this.opts.loadSchema != "function") {
          throw new Error("options.loadSchema should be a function");
        }
        const { loadSchema } = this.opts;
        return runCompileAsync.call(this, schema, meta);
        async function runCompileAsync(_schema, _meta) {
          await loadMetaSchema.call(this, _schema.$schema);
          const sch = this._addSchema(_schema, _meta);
          return sch.validate || _compileAsync.call(this, sch);
        }
        async function loadMetaSchema($ref) {
          if ($ref && !this.getSchema($ref)) {
            await runCompileAsync.call(this, { $ref }, true);
          }
        }
        async function _compileAsync(sch) {
          try {
            return this._compileSchemaEnv(sch);
          } catch (e) {
            if (!(e instanceof ref_error_1.default))
              throw e;
            checkLoaded.call(this, e);
            await loadMissingSchema.call(this, e.missingSchema);
            return _compileAsync.call(this, sch);
          }
        }
        function checkLoaded({ missingSchema: ref, missingRef }) {
          if (this.refs[ref]) {
            throw new Error(`AnySchema ${ref} is loaded but ${missingRef} cannot be resolved`);
          }
        }
        async function loadMissingSchema(ref) {
          const _schema = await _loadSchema.call(this, ref);
          if (!this.refs[ref])
            await loadMetaSchema.call(this, _schema.$schema);
          if (!this.refs[ref])
            this.addSchema(_schema, ref, meta);
        }
        async function _loadSchema(ref) {
          const p = this._loading[ref];
          if (p)
            return p;
          try {
            return await (this._loading[ref] = loadSchema(ref));
          } finally {
            delete this._loading[ref];
          }
        }
      }
      // Adds schema to the instance
      addSchema(schema, key, _meta, _validateSchema = this.opts.validateSchema) {
        if (Array.isArray(schema)) {
          for (const sch of schema)
            this.addSchema(sch, void 0, _meta, _validateSchema);
          return this;
        }
        let id;
        if (typeof schema === "object") {
          const { schemaId } = this.opts;
          id = schema[schemaId];
          if (id !== void 0 && typeof id != "string") {
            throw new Error(`schema ${schemaId} must be string`);
          }
        }
        key = (0, resolve_1.normalizeId)(key || id);
        this._checkUnique(key);
        this.schemas[key] = this._addSchema(schema, _meta, key, _validateSchema, true);
        return this;
      }
      // Add schema that will be used to validate other schemas
      // options in META_IGNORE_OPTIONS are alway set to false
      addMetaSchema(schema, key, _validateSchema = this.opts.validateSchema) {
        this.addSchema(schema, key, true, _validateSchema);
        return this;
      }
      //  Validate schema against its meta-schema
      validateSchema(schema, throwOrLogError) {
        if (typeof schema == "boolean")
          return true;
        let $schema;
        $schema = schema.$schema;
        if ($schema !== void 0 && typeof $schema != "string") {
          throw new Error("$schema must be a string");
        }
        $schema = $schema || this.opts.defaultMeta || this.defaultMeta();
        if (!$schema) {
          this.logger.warn("meta-schema not available");
          this.errors = null;
          return true;
        }
        const valid = this.validate($schema, schema);
        if (!valid && throwOrLogError) {
          const message = "schema is invalid: " + this.errorsText();
          if (this.opts.validateSchema === "log")
            this.logger.error(message);
          else
            throw new Error(message);
        }
        return valid;
      }
      // Get compiled schema by `key` or `ref`.
      // (`key` that was passed to `addSchema` or full schema reference - `schema.$id` or resolved id)
      getSchema(keyRef) {
        let sch;
        while (typeof (sch = getSchEnv.call(this, keyRef)) == "string")
          keyRef = sch;
        if (sch === void 0) {
          const { schemaId } = this.opts;
          const root = new compile_1.SchemaEnv({ schema: {}, schemaId });
          sch = compile_1.resolveSchema.call(this, root, keyRef);
          if (!sch)
            return;
          this.refs[keyRef] = sch;
        }
        return sch.validate || this._compileSchemaEnv(sch);
      }
      // Remove cached schema(s).
      // If no parameter is passed all schemas but meta-schemas are removed.
      // If RegExp is passed all schemas with key/id matching pattern but meta-schemas are removed.
      // Even if schema is referenced by other schemas it still can be removed as other schemas have local references.
      removeSchema(schemaKeyRef) {
        if (schemaKeyRef instanceof RegExp) {
          this._removeAllSchemas(this.schemas, schemaKeyRef);
          this._removeAllSchemas(this.refs, schemaKeyRef);
          return this;
        }
        switch (typeof schemaKeyRef) {
          case "undefined":
            this._removeAllSchemas(this.schemas);
            this._removeAllSchemas(this.refs);
            this._cache.clear();
            return this;
          case "string": {
            const sch = getSchEnv.call(this, schemaKeyRef);
            if (typeof sch == "object")
              this._cache.delete(sch.schema);
            delete this.schemas[schemaKeyRef];
            delete this.refs[schemaKeyRef];
            return this;
          }
          case "object": {
            const cacheKey = schemaKeyRef;
            this._cache.delete(cacheKey);
            let id = schemaKeyRef[this.opts.schemaId];
            if (id) {
              id = (0, resolve_1.normalizeId)(id);
              delete this.schemas[id];
              delete this.refs[id];
            }
            return this;
          }
          default:
            throw new Error("ajv.removeSchema: invalid parameter");
        }
      }
      // add "vocabulary" - a collection of keywords
      addVocabulary(definitions) {
        for (const def of definitions)
          this.addKeyword(def);
        return this;
      }
      addKeyword(kwdOrDef, def) {
        let keyword;
        if (typeof kwdOrDef == "string") {
          keyword = kwdOrDef;
          if (typeof def == "object") {
            this.logger.warn("these parameters are deprecated, see docs for addKeyword");
            def.keyword = keyword;
          }
        } else if (typeof kwdOrDef == "object" && def === void 0) {
          def = kwdOrDef;
          keyword = def.keyword;
          if (Array.isArray(keyword) && !keyword.length) {
            throw new Error("addKeywords: keyword must be string or non-empty array");
          }
        } else {
          throw new Error("invalid addKeywords parameters");
        }
        checkKeyword.call(this, keyword, def);
        if (!def) {
          (0, util_1.eachItem)(keyword, (kwd) => addRule.call(this, kwd));
          return this;
        }
        keywordMetaschema.call(this, def);
        const definition = {
          ...def,
          type: (0, dataType_1.getJSONTypes)(def.type),
          schemaType: (0, dataType_1.getJSONTypes)(def.schemaType)
        };
        (0, util_1.eachItem)(keyword, definition.type.length === 0 ? (k) => addRule.call(this, k, definition) : (k) => definition.type.forEach((t) => addRule.call(this, k, definition, t)));
        return this;
      }
      getKeyword(keyword) {
        const rule = this.RULES.all[keyword];
        return typeof rule == "object" ? rule.definition : !!rule;
      }
      // Remove keyword
      removeKeyword(keyword) {
        const { RULES } = this;
        delete RULES.keywords[keyword];
        delete RULES.all[keyword];
        for (const group of RULES.rules) {
          const i = group.rules.findIndex((rule) => rule.keyword === keyword);
          if (i >= 0)
            group.rules.splice(i, 1);
        }
        return this;
      }
      // Add format
      addFormat(name, format) {
        if (typeof format == "string")
          format = new RegExp(format);
        this.formats[name] = format;
        return this;
      }
      errorsText(errors = this.errors, { separator = ", ", dataVar = "data" } = {}) {
        if (!errors || errors.length === 0)
          return "No errors";
        return errors.map((e) => `${dataVar}${e.instancePath} ${e.message}`).reduce((text4, msg) => text4 + separator + msg);
      }
      $dataMetaSchema(metaSchema, keywordsJsonPointers) {
        const rules = this.RULES.all;
        metaSchema = JSON.parse(JSON.stringify(metaSchema));
        for (const jsonPointer of keywordsJsonPointers) {
          const segments = jsonPointer.split("/").slice(1);
          let keywords = metaSchema;
          for (const seg of segments)
            keywords = keywords[seg];
          for (const key in rules) {
            const rule = rules[key];
            if (typeof rule != "object")
              continue;
            const { $data } = rule.definition;
            const schema = keywords[key];
            if ($data && schema)
              keywords[key] = schemaOrData(schema);
          }
        }
        return metaSchema;
      }
      _removeAllSchemas(schemas, regex) {
        for (const keyRef in schemas) {
          const sch = schemas[keyRef];
          if (!regex || regex.test(keyRef)) {
            if (typeof sch == "string") {
              delete schemas[keyRef];
            } else if (sch && !sch.meta) {
              this._cache.delete(sch.schema);
              delete schemas[keyRef];
            }
          }
        }
      }
      _addSchema(schema, meta, baseId, validateSchema = this.opts.validateSchema, addSchema = this.opts.addUsedSchema) {
        let id;
        const { schemaId } = this.opts;
        if (typeof schema == "object") {
          id = schema[schemaId];
        } else {
          if (this.opts.jtd)
            throw new Error("schema must be object");
          else if (typeof schema != "boolean")
            throw new Error("schema must be object or boolean");
        }
        let sch = this._cache.get(schema);
        if (sch !== void 0)
          return sch;
        baseId = (0, resolve_1.normalizeId)(id || baseId);
        const localRefs = resolve_1.getSchemaRefs.call(this, schema, baseId);
        sch = new compile_1.SchemaEnv({ schema, schemaId, meta, baseId, localRefs });
        this._cache.set(sch.schema, sch);
        if (addSchema && !baseId.startsWith("#")) {
          if (baseId)
            this._checkUnique(baseId);
          this.refs[baseId] = sch;
        }
        if (validateSchema)
          this.validateSchema(schema, true);
        return sch;
      }
      _checkUnique(id) {
        if (this.schemas[id] || this.refs[id]) {
          throw new Error(`schema with key or id "${id}" already exists`);
        }
      }
      _compileSchemaEnv(sch) {
        if (sch.meta)
          this._compileMetaSchema(sch);
        else
          compile_1.compileSchema.call(this, sch);
        if (!sch.validate)
          throw new Error("ajv implementation error");
        return sch.validate;
      }
      _compileMetaSchema(sch) {
        const currentOpts = this.opts;
        this.opts = this._metaOpts;
        try {
          compile_1.compileSchema.call(this, sch);
        } finally {
          this.opts = currentOpts;
        }
      }
    };
    Ajv5.ValidationError = validation_error_1.default;
    Ajv5.MissingRefError = ref_error_1.default;
    exports.default = Ajv5;
    function checkOptions(checkOpts, options, msg, log = "error") {
      for (const key in checkOpts) {
        const opt = key;
        if (opt in options)
          this.logger[log](`${msg}: option ${key}. ${checkOpts[opt]}`);
      }
    }
    function getSchEnv(keyRef) {
      keyRef = (0, resolve_1.normalizeId)(keyRef);
      return this.schemas[keyRef] || this.refs[keyRef];
    }
    function addInitialSchemas() {
      const optsSchemas = this.opts.schemas;
      if (!optsSchemas)
        return;
      if (Array.isArray(optsSchemas))
        this.addSchema(optsSchemas);
      else
        for (const key in optsSchemas)
          this.addSchema(optsSchemas[key], key);
    }
    function addInitialFormats() {
      for (const name in this.opts.formats) {
        const format = this.opts.formats[name];
        if (format)
          this.addFormat(name, format);
      }
    }
    function addInitialKeywords(defs) {
      if (Array.isArray(defs)) {
        this.addVocabulary(defs);
        return;
      }
      this.logger.warn("keywords option as map is deprecated, pass array");
      for (const keyword in defs) {
        const def = defs[keyword];
        if (!def.keyword)
          def.keyword = keyword;
        this.addKeyword(def);
      }
    }
    function getMetaSchemaOptions() {
      const metaOpts = { ...this.opts };
      for (const opt of META_IGNORE_OPTIONS)
        delete metaOpts[opt];
      return metaOpts;
    }
    var noLogs = { log() {
    }, warn() {
    }, error() {
    } };
    function getLogger(logger) {
      if (logger === false)
        return noLogs;
      if (logger === void 0)
        return console;
      if (logger.log && logger.warn && logger.error)
        return logger;
      throw new Error("logger must implement log, warn and error methods");
    }
    var KEYWORD_NAME = /^[a-z_$][a-z0-9_$:-]*$/i;
    function checkKeyword(keyword, def) {
      const { RULES } = this;
      (0, util_1.eachItem)(keyword, (kwd) => {
        if (RULES.keywords[kwd])
          throw new Error(`Keyword ${kwd} is already defined`);
        if (!KEYWORD_NAME.test(kwd))
          throw new Error(`Keyword ${kwd} has invalid name`);
      });
      if (!def)
        return;
      if (def.$data && !("code" in def || "validate" in def)) {
        throw new Error('$data keyword must have "code" or "validate" function');
      }
    }
    function addRule(keyword, definition, dataType) {
      var _a;
      const post = definition === null || definition === void 0 ? void 0 : definition.post;
      if (dataType && post)
        throw new Error('keyword with "post" flag cannot have "type"');
      const { RULES } = this;
      let ruleGroup = post ? RULES.post : RULES.rules.find(({ type: t }) => t === dataType);
      if (!ruleGroup) {
        ruleGroup = { type: dataType, rules: [] };
        RULES.rules.push(ruleGroup);
      }
      RULES.keywords[keyword] = true;
      if (!definition)
        return;
      const rule = {
        keyword,
        definition: {
          ...definition,
          type: (0, dataType_1.getJSONTypes)(definition.type),
          schemaType: (0, dataType_1.getJSONTypes)(definition.schemaType)
        }
      };
      if (definition.before)
        addBeforeRule.call(this, ruleGroup, rule, definition.before);
      else
        ruleGroup.rules.push(rule);
      RULES.all[keyword] = rule;
      (_a = definition.implements) === null || _a === void 0 ? void 0 : _a.forEach((kwd) => this.addKeyword(kwd));
    }
    function addBeforeRule(ruleGroup, rule, before) {
      const i = ruleGroup.rules.findIndex((_rule) => _rule.keyword === before);
      if (i >= 0) {
        ruleGroup.rules.splice(i, 0, rule);
      } else {
        ruleGroup.rules.push(rule);
        this.logger.warn(`rule ${before} is not defined`);
      }
    }
    function keywordMetaschema(def) {
      let { metaSchema } = def;
      if (metaSchema === void 0)
        return;
      if (def.$data && this.opts.$data)
        metaSchema = schemaOrData(metaSchema);
      def.validateSchema = this.compile(metaSchema, true);
    }
    var $dataRef = {
      $ref: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#"
    };
    function schemaOrData(schema) {
      return { anyOf: [schema, $dataRef] };
    }
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/core/id.js
var require_id = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/core/id.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var def = {
      keyword: "id",
      code() {
        throw new Error('NOT SUPPORTED: keyword "id", use "$id" for schema ID');
      }
    };
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/core/ref.js
var require_ref = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/core/ref.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.callRef = exports.getValidate = void 0;
    var ref_error_1 = require_ref_error();
    var code_1 = require_code2();
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var compile_1 = require_compile();
    var util_1 = require_util();
    var def = {
      keyword: "$ref",
      schemaType: "string",
      code(cxt) {
        const { gen, schema: $ref, it } = cxt;
        const { baseId, schemaEnv: env, validateName, opts, self } = it;
        const { root } = env;
        if (($ref === "#" || $ref === "#/") && baseId === root.baseId)
          return callRootRef();
        const schOrEnv = compile_1.resolveRef.call(self, root, baseId, $ref);
        if (schOrEnv === void 0)
          throw new ref_error_1.default(it.opts.uriResolver, baseId, $ref);
        if (schOrEnv instanceof compile_1.SchemaEnv)
          return callValidate(schOrEnv);
        return inlineRefSchema(schOrEnv);
        function callRootRef() {
          if (env === root)
            return callRef(cxt, validateName, env, env.$async);
          const rootName = gen.scopeValue("root", { ref: root });
          return callRef(cxt, (0, codegen_1._)`${rootName}.validate`, root, root.$async);
        }
        function callValidate(sch) {
          const v = getValidate(cxt, sch);
          callRef(cxt, v, sch, sch.$async);
        }
        function inlineRefSchema(sch) {
          const schName = gen.scopeValue("schema", opts.code.source === true ? { ref: sch, code: (0, codegen_1.stringify)(sch) } : { ref: sch });
          const valid = gen.name("valid");
          const schCxt = cxt.subschema({
            schema: sch,
            dataTypes: [],
            schemaPath: codegen_1.nil,
            topSchemaRef: schName,
            errSchemaPath: $ref
          }, valid);
          cxt.mergeEvaluated(schCxt);
          cxt.ok(valid);
        }
      }
    };
    function getValidate(cxt, sch) {
      const { gen } = cxt;
      return sch.validate ? gen.scopeValue("validate", { ref: sch.validate }) : (0, codegen_1._)`${gen.scopeValue("wrapper", { ref: sch })}.validate`;
    }
    exports.getValidate = getValidate;
    function callRef(cxt, v, sch, $async) {
      const { gen, it } = cxt;
      const { allErrors, schemaEnv: env, opts } = it;
      const passCxt = opts.passContext ? names_1.default.this : codegen_1.nil;
      if ($async)
        callAsyncRef();
      else
        callSyncRef();
      function callAsyncRef() {
        if (!env.$async)
          throw new Error("async schema referenced by sync schema");
        const valid = gen.let("valid");
        gen.try(() => {
          gen.code((0, codegen_1._)`await ${(0, code_1.callValidateCode)(cxt, v, passCxt)}`);
          addEvaluatedFrom(v);
          if (!allErrors)
            gen.assign(valid, true);
        }, (e) => {
          gen.if((0, codegen_1._)`!(${e} instanceof ${it.ValidationError})`, () => gen.throw(e));
          addErrorsFrom(e);
          if (!allErrors)
            gen.assign(valid, false);
        });
        cxt.ok(valid);
      }
      function callSyncRef() {
        cxt.result((0, code_1.callValidateCode)(cxt, v, passCxt), () => addEvaluatedFrom(v), () => addErrorsFrom(v));
      }
      function addErrorsFrom(source) {
        const errs = (0, codegen_1._)`${source}.errors`;
        gen.assign(names_1.default.vErrors, (0, codegen_1._)`${names_1.default.vErrors} === null ? ${errs} : ${names_1.default.vErrors}.concat(${errs})`);
        gen.assign(names_1.default.errors, (0, codegen_1._)`${names_1.default.vErrors}.length`);
      }
      function addEvaluatedFrom(source) {
        var _a;
        if (!it.opts.unevaluated)
          return;
        const schEvaluated = (_a = sch === null || sch === void 0 ? void 0 : sch.validate) === null || _a === void 0 ? void 0 : _a.evaluated;
        if (it.props !== true) {
          if (schEvaluated && !schEvaluated.dynamicProps) {
            if (schEvaluated.props !== void 0) {
              it.props = util_1.mergeEvaluated.props(gen, schEvaluated.props, it.props);
            }
          } else {
            const props = gen.var("props", (0, codegen_1._)`${source}.evaluated.props`);
            it.props = util_1.mergeEvaluated.props(gen, props, it.props, codegen_1.Name);
          }
        }
        if (it.items !== true) {
          if (schEvaluated && !schEvaluated.dynamicItems) {
            if (schEvaluated.items !== void 0) {
              it.items = util_1.mergeEvaluated.items(gen, schEvaluated.items, it.items);
            }
          } else {
            const items = gen.var("items", (0, codegen_1._)`${source}.evaluated.items`);
            it.items = util_1.mergeEvaluated.items(gen, items, it.items, codegen_1.Name);
          }
        }
      }
    }
    exports.callRef = callRef;
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/core/index.js
var require_core2 = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/core/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var id_1 = require_id();
    var ref_1 = require_ref();
    var core = [
      "$schema",
      "$id",
      "$defs",
      "$vocabulary",
      { keyword: "$comment" },
      "definitions",
      id_1.default,
      ref_1.default
    ];
    exports.default = core;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/validation/limitNumber.js
var require_limitNumber = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/validation/limitNumber.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var ops = codegen_1.operators;
    var KWDs = {
      maximum: { okStr: "<=", ok: ops.LTE, fail: ops.GT },
      minimum: { okStr: ">=", ok: ops.GTE, fail: ops.LT },
      exclusiveMaximum: { okStr: "<", ok: ops.LT, fail: ops.GTE },
      exclusiveMinimum: { okStr: ">", ok: ops.GT, fail: ops.LTE }
    };
    var error = {
      message: ({ keyword, schemaCode }) => (0, codegen_1.str)`must be ${KWDs[keyword].okStr} ${schemaCode}`,
      params: ({ keyword, schemaCode }) => (0, codegen_1._)`{comparison: ${KWDs[keyword].okStr}, limit: ${schemaCode}}`
    };
    var def = {
      keyword: Object.keys(KWDs),
      type: "number",
      schemaType: "number",
      $data: true,
      error,
      code(cxt) {
        const { keyword, data, schemaCode } = cxt;
        cxt.fail$data((0, codegen_1._)`${data} ${KWDs[keyword].fail} ${schemaCode} || isNaN(${data})`);
      }
    };
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/validation/multipleOf.js
var require_multipleOf = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/validation/multipleOf.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var error = {
      message: ({ schemaCode }) => (0, codegen_1.str)`must be multiple of ${schemaCode}`,
      params: ({ schemaCode }) => (0, codegen_1._)`{multipleOf: ${schemaCode}}`
    };
    var def = {
      keyword: "multipleOf",
      type: "number",
      schemaType: "number",
      $data: true,
      error,
      code(cxt) {
        const { gen, data, schemaCode, it } = cxt;
        const prec = it.opts.multipleOfPrecision;
        const res = gen.let("res");
        const invalid = prec ? (0, codegen_1._)`Math.abs(Math.round(${res}) - ${res}) > 1e-${prec}` : (0, codegen_1._)`${res} !== parseInt(${res})`;
        cxt.fail$data((0, codegen_1._)`(${schemaCode} === 0 || (${res} = ${data}/${schemaCode}, ${invalid}))`);
      }
    };
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/runtime/ucs2length.js
var require_ucs2length = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/runtime/ucs2length.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    function ucs2length(str) {
      const len = str.length;
      let length = 0;
      let pos = 0;
      let value;
      while (pos < len) {
        length++;
        value = str.charCodeAt(pos++);
        if (value >= 55296 && value <= 56319 && pos < len) {
          value = str.charCodeAt(pos);
          if ((value & 64512) === 56320)
            pos++;
        }
      }
      return length;
    }
    exports.default = ucs2length;
    ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/validation/limitLength.js
var require_limitLength = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/validation/limitLength.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var ucs2length_1 = require_ucs2length();
    var error = {
      message({ keyword, schemaCode }) {
        const comp = keyword === "maxLength" ? "more" : "fewer";
        return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} characters`;
      },
      params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
    };
    var def = {
      keyword: ["maxLength", "minLength"],
      type: "string",
      schemaType: "number",
      $data: true,
      error,
      code(cxt) {
        const { keyword, data, schemaCode, it } = cxt;
        const op = keyword === "maxLength" ? codegen_1.operators.GT : codegen_1.operators.LT;
        const len = it.opts.unicode === false ? (0, codegen_1._)`${data}.length` : (0, codegen_1._)`${(0, util_1.useFunc)(cxt.gen, ucs2length_1.default)}(${data})`;
        cxt.fail$data((0, codegen_1._)`${len} ${op} ${schemaCode}`);
      }
    };
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/validation/pattern.js
var require_pattern = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/validation/pattern.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var code_1 = require_code2();
    var util_1 = require_util();
    var codegen_1 = require_codegen();
    var error = {
      message: ({ schemaCode }) => (0, codegen_1.str)`must match pattern "${schemaCode}"`,
      params: ({ schemaCode }) => (0, codegen_1._)`{pattern: ${schemaCode}}`
    };
    var def = {
      keyword: "pattern",
      type: "string",
      schemaType: "string",
      $data: true,
      error,
      code(cxt) {
        const { gen, data, $data, schema, schemaCode, it } = cxt;
        const u = it.opts.unicodeRegExp ? "u" : "";
        if ($data) {
          const { regExp } = it.opts.code;
          const regExpCode = regExp.code === "new RegExp" ? (0, codegen_1._)`new RegExp` : (0, util_1.useFunc)(gen, regExp);
          const valid = gen.let("valid");
          gen.try(() => gen.assign(valid, (0, codegen_1._)`${regExpCode}(${schemaCode}, ${u}).test(${data})`), () => gen.assign(valid, false));
          cxt.fail$data((0, codegen_1._)`!${valid}`);
        } else {
          const regExp = (0, code_1.usePattern)(cxt, schema);
          cxt.fail$data((0, codegen_1._)`!${regExp}.test(${data})`);
        }
      }
    };
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/validation/limitProperties.js
var require_limitProperties = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/validation/limitProperties.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var error = {
      message({ keyword, schemaCode }) {
        const comp = keyword === "maxProperties" ? "more" : "fewer";
        return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} properties`;
      },
      params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
    };
    var def = {
      keyword: ["maxProperties", "minProperties"],
      type: "object",
      schemaType: "number",
      $data: true,
      error,
      code(cxt) {
        const { keyword, data, schemaCode } = cxt;
        const op = keyword === "maxProperties" ? codegen_1.operators.GT : codegen_1.operators.LT;
        cxt.fail$data((0, codegen_1._)`Object.keys(${data}).length ${op} ${schemaCode}`);
      }
    };
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/validation/required.js
var require_required = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/validation/required.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var code_1 = require_code2();
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error = {
      message: ({ params: { missingProperty } }) => (0, codegen_1.str)`must have required property '${missingProperty}'`,
      params: ({ params: { missingProperty } }) => (0, codegen_1._)`{missingProperty: ${missingProperty}}`
    };
    var def = {
      keyword: "required",
      type: "object",
      schemaType: "array",
      $data: true,
      error,
      code(cxt) {
        const { gen, schema, schemaCode, data, $data, it } = cxt;
        const { opts } = it;
        if (!$data && schema.length === 0)
          return;
        const useLoop = schema.length >= opts.loopRequired;
        if (it.allErrors)
          allErrorsMode();
        else
          exitOnErrorMode();
        if (opts.strictRequired) {
          const props = cxt.parentSchema.properties;
          const { definedProperties } = cxt.it;
          for (const requiredKey of schema) {
            if ((props === null || props === void 0 ? void 0 : props[requiredKey]) === void 0 && !definedProperties.has(requiredKey)) {
              const schemaPath = it.schemaEnv.baseId + it.errSchemaPath;
              const msg = `required property "${requiredKey}" is not defined at "${schemaPath}" (strictRequired)`;
              (0, util_1.checkStrictMode)(it, msg, it.opts.strictRequired);
            }
          }
        }
        function allErrorsMode() {
          if (useLoop || $data) {
            cxt.block$data(codegen_1.nil, loopAllRequired);
          } else {
            for (const prop of schema) {
              (0, code_1.checkReportMissingProp)(cxt, prop);
            }
          }
        }
        function exitOnErrorMode() {
          const missing = gen.let("missing");
          if (useLoop || $data) {
            const valid = gen.let("valid", true);
            cxt.block$data(valid, () => loopUntilMissing(missing, valid));
            cxt.ok(valid);
          } else {
            gen.if((0, code_1.checkMissingProp)(cxt, schema, missing));
            (0, code_1.reportMissingProp)(cxt, missing);
            gen.else();
          }
        }
        function loopAllRequired() {
          gen.forOf("prop", schemaCode, (prop) => {
            cxt.setParams({ missingProperty: prop });
            gen.if((0, code_1.noPropertyInData)(gen, data, prop, opts.ownProperties), () => cxt.error());
          });
        }
        function loopUntilMissing(missing, valid) {
          cxt.setParams({ missingProperty: missing });
          gen.forOf(missing, schemaCode, () => {
            gen.assign(valid, (0, code_1.propertyInData)(gen, data, missing, opts.ownProperties));
            gen.if((0, codegen_1.not)(valid), () => {
              cxt.error();
              gen.break();
            });
          }, codegen_1.nil);
        }
      }
    };
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/validation/limitItems.js
var require_limitItems = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/validation/limitItems.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var error = {
      message({ keyword, schemaCode }) {
        const comp = keyword === "maxItems" ? "more" : "fewer";
        return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} items`;
      },
      params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
    };
    var def = {
      keyword: ["maxItems", "minItems"],
      type: "array",
      schemaType: "number",
      $data: true,
      error,
      code(cxt) {
        const { keyword, data, schemaCode } = cxt;
        const op = keyword === "maxItems" ? codegen_1.operators.GT : codegen_1.operators.LT;
        cxt.fail$data((0, codegen_1._)`${data}.length ${op} ${schemaCode}`);
      }
    };
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/runtime/equal.js
var require_equal = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/runtime/equal.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var equal2 = require_fast_deep_equal();
    equal2.code = 'require("ajv/dist/runtime/equal").default';
    exports.default = equal2;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/validation/uniqueItems.js
var require_uniqueItems = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/validation/uniqueItems.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var dataType_1 = require_dataType();
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var equal_1 = require_equal();
    var error = {
      message: ({ params: { i, j } }) => (0, codegen_1.str)`must NOT have duplicate items (items ## ${j} and ${i} are identical)`,
      params: ({ params: { i, j } }) => (0, codegen_1._)`{i: ${i}, j: ${j}}`
    };
    var def = {
      keyword: "uniqueItems",
      type: "array",
      schemaType: "boolean",
      $data: true,
      error,
      code(cxt) {
        const { gen, data, $data, schema, parentSchema, schemaCode, it } = cxt;
        if (!$data && !schema)
          return;
        const valid = gen.let("valid");
        const itemTypes = parentSchema.items ? (0, dataType_1.getSchemaTypes)(parentSchema.items) : [];
        cxt.block$data(valid, validateUniqueItems, (0, codegen_1._)`${schemaCode} === false`);
        cxt.ok(valid);
        function validateUniqueItems() {
          const i = gen.let("i", (0, codegen_1._)`${data}.length`);
          const j = gen.let("j");
          cxt.setParams({ i, j });
          gen.assign(valid, true);
          gen.if((0, codegen_1._)`${i} > 1`, () => (canOptimize() ? loopN : loopN2)(i, j));
        }
        function canOptimize() {
          return itemTypes.length > 0 && !itemTypes.some((t) => t === "object" || t === "array");
        }
        function loopN(i, j) {
          const item = gen.name("item");
          const wrongType = (0, dataType_1.checkDataTypes)(itemTypes, item, it.opts.strictNumbers, dataType_1.DataType.Wrong);
          const indices = gen.const("indices", (0, codegen_1._)`{}`);
          gen.for((0, codegen_1._)`;${i}--;`, () => {
            gen.let(item, (0, codegen_1._)`${data}[${i}]`);
            gen.if(wrongType, (0, codegen_1._)`continue`);
            if (itemTypes.length > 1)
              gen.if((0, codegen_1._)`typeof ${item} == "string"`, (0, codegen_1._)`${item} += "_"`);
            gen.if((0, codegen_1._)`typeof ${indices}[${item}] == "number"`, () => {
              gen.assign(j, (0, codegen_1._)`${indices}[${item}]`);
              cxt.error();
              gen.assign(valid, false).break();
            }).code((0, codegen_1._)`${indices}[${item}] = ${i}`);
          });
        }
        function loopN2(i, j) {
          const eql = (0, util_1.useFunc)(gen, equal_1.default);
          const outer = gen.name("outer");
          gen.label(outer).for((0, codegen_1._)`;${i}--;`, () => gen.for((0, codegen_1._)`${j} = ${i}; ${j}--;`, () => gen.if((0, codegen_1._)`${eql}(${data}[${i}], ${data}[${j}])`, () => {
            cxt.error();
            gen.assign(valid, false).break(outer);
          })));
        }
      }
    };
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/validation/const.js
var require_const = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/validation/const.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var equal_1 = require_equal();
    var error = {
      message: "must be equal to constant",
      params: ({ schemaCode }) => (0, codegen_1._)`{allowedValue: ${schemaCode}}`
    };
    var def = {
      keyword: "const",
      $data: true,
      error,
      code(cxt) {
        const { gen, data, $data, schemaCode, schema } = cxt;
        if ($data || schema && typeof schema == "object") {
          cxt.fail$data((0, codegen_1._)`!${(0, util_1.useFunc)(gen, equal_1.default)}(${data}, ${schemaCode})`);
        } else {
          cxt.fail((0, codegen_1._)`${schema} !== ${data}`);
        }
      }
    };
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/validation/enum.js
var require_enum = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/validation/enum.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var equal_1 = require_equal();
    var error = {
      message: "must be equal to one of the allowed values",
      params: ({ schemaCode }) => (0, codegen_1._)`{allowedValues: ${schemaCode}}`
    };
    var def = {
      keyword: "enum",
      schemaType: "array",
      $data: true,
      error,
      code(cxt) {
        const { gen, data, $data, schema, schemaCode, it } = cxt;
        if (!$data && schema.length === 0)
          throw new Error("enum must have non-empty array");
        const useLoop = schema.length >= it.opts.loopEnum;
        let eql;
        const getEql = () => eql !== null && eql !== void 0 ? eql : eql = (0, util_1.useFunc)(gen, equal_1.default);
        let valid;
        if (useLoop || $data) {
          valid = gen.let("valid");
          cxt.block$data(valid, loopEnum);
        } else {
          if (!Array.isArray(schema))
            throw new Error("ajv implementation error");
          const vSchema = gen.const("vSchema", schemaCode);
          valid = (0, codegen_1.or)(...schema.map((_x, i) => equalCode(vSchema, i)));
        }
        cxt.pass(valid);
        function loopEnum() {
          gen.assign(valid, false);
          gen.forOf("v", schemaCode, (v) => gen.if((0, codegen_1._)`${getEql()}(${data}, ${v})`, () => gen.assign(valid, true).break()));
        }
        function equalCode(vSchema, i) {
          const sch = schema[i];
          return typeof sch === "object" && sch !== null ? (0, codegen_1._)`${getEql()}(${data}, ${vSchema}[${i}])` : (0, codegen_1._)`${data} === ${sch}`;
        }
      }
    };
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/validation/index.js
var require_validation = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/validation/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var limitNumber_1 = require_limitNumber();
    var multipleOf_1 = require_multipleOf();
    var limitLength_1 = require_limitLength();
    var pattern_1 = require_pattern();
    var limitProperties_1 = require_limitProperties();
    var required_1 = require_required();
    var limitItems_1 = require_limitItems();
    var uniqueItems_1 = require_uniqueItems();
    var const_1 = require_const();
    var enum_1 = require_enum();
    var validation = [
      // number
      limitNumber_1.default,
      multipleOf_1.default,
      // string
      limitLength_1.default,
      pattern_1.default,
      // object
      limitProperties_1.default,
      required_1.default,
      // array
      limitItems_1.default,
      uniqueItems_1.default,
      // any
      { keyword: "type", schemaType: ["string", "array"] },
      { keyword: "nullable", schemaType: "boolean" },
      const_1.default,
      enum_1.default
    ];
    exports.default = validation;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/additionalItems.js
var require_additionalItems = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/additionalItems.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.validateAdditionalItems = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error = {
      message: ({ params: { len } }) => (0, codegen_1.str)`must NOT have more than ${len} items`,
      params: ({ params: { len } }) => (0, codegen_1._)`{limit: ${len}}`
    };
    var def = {
      keyword: "additionalItems",
      type: "array",
      schemaType: ["boolean", "object"],
      before: "uniqueItems",
      error,
      code(cxt) {
        const { parentSchema, it } = cxt;
        const { items } = parentSchema;
        if (!Array.isArray(items)) {
          (0, util_1.checkStrictMode)(it, '"additionalItems" is ignored when "items" is not an array of schemas');
          return;
        }
        validateAdditionalItems(cxt, items);
      }
    };
    function validateAdditionalItems(cxt, items) {
      const { gen, schema, data, keyword, it } = cxt;
      it.items = true;
      const len = gen.const("len", (0, codegen_1._)`${data}.length`);
      if (schema === false) {
        cxt.setParams({ len: items.length });
        cxt.pass((0, codegen_1._)`${len} <= ${items.length}`);
      } else if (typeof schema == "object" && !(0, util_1.alwaysValidSchema)(it, schema)) {
        const valid = gen.var("valid", (0, codegen_1._)`${len} <= ${items.length}`);
        gen.if((0, codegen_1.not)(valid), () => validateItems(valid));
        cxt.ok(valid);
      }
      function validateItems(valid) {
        gen.forRange("i", items.length, len, (i) => {
          cxt.subschema({ keyword, dataProp: i, dataPropType: util_1.Type.Num }, valid);
          if (!it.allErrors)
            gen.if((0, codegen_1.not)(valid), () => gen.break());
        });
      }
    }
    exports.validateAdditionalItems = validateAdditionalItems;
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/items.js
var require_items = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/items.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.validateTuple = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var code_1 = require_code2();
    var def = {
      keyword: "items",
      type: "array",
      schemaType: ["object", "array", "boolean"],
      before: "uniqueItems",
      code(cxt) {
        const { schema, it } = cxt;
        if (Array.isArray(schema))
          return validateTuple(cxt, "additionalItems", schema);
        it.items = true;
        if ((0, util_1.alwaysValidSchema)(it, schema))
          return;
        cxt.ok((0, code_1.validateArray)(cxt));
      }
    };
    function validateTuple(cxt, extraItems, schArr = cxt.schema) {
      const { gen, parentSchema, data, keyword, it } = cxt;
      checkStrictTuple(parentSchema);
      if (it.opts.unevaluated && schArr.length && it.items !== true) {
        it.items = util_1.mergeEvaluated.items(gen, schArr.length, it.items);
      }
      const valid = gen.name("valid");
      const len = gen.const("len", (0, codegen_1._)`${data}.length`);
      schArr.forEach((sch, i) => {
        if ((0, util_1.alwaysValidSchema)(it, sch))
          return;
        gen.if((0, codegen_1._)`${len} > ${i}`, () => cxt.subschema({
          keyword,
          schemaProp: i,
          dataProp: i
        }, valid));
        cxt.ok(valid);
      });
      function checkStrictTuple(sch) {
        const { opts, errSchemaPath } = it;
        const l = schArr.length;
        const fullTuple = l === sch.minItems && (l === sch.maxItems || sch[extraItems] === false);
        if (opts.strictTuples && !fullTuple) {
          const msg = `"${keyword}" is ${l}-tuple, but minItems or maxItems/${extraItems} are not specified or different at path "${errSchemaPath}"`;
          (0, util_1.checkStrictMode)(it, msg, opts.strictTuples);
        }
      }
    }
    exports.validateTuple = validateTuple;
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/prefixItems.js
var require_prefixItems = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/prefixItems.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var items_1 = require_items();
    var def = {
      keyword: "prefixItems",
      type: "array",
      schemaType: ["array"],
      before: "uniqueItems",
      code: (cxt) => (0, items_1.validateTuple)(cxt, "items")
    };
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/items2020.js
var require_items2020 = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/items2020.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var code_1 = require_code2();
    var additionalItems_1 = require_additionalItems();
    var error = {
      message: ({ params: { len } }) => (0, codegen_1.str)`must NOT have more than ${len} items`,
      params: ({ params: { len } }) => (0, codegen_1._)`{limit: ${len}}`
    };
    var def = {
      keyword: "items",
      type: "array",
      schemaType: ["object", "boolean"],
      before: "uniqueItems",
      error,
      code(cxt) {
        const { schema, parentSchema, it } = cxt;
        const { prefixItems } = parentSchema;
        it.items = true;
        if ((0, util_1.alwaysValidSchema)(it, schema))
          return;
        if (prefixItems)
          (0, additionalItems_1.validateAdditionalItems)(cxt, prefixItems);
        else
          cxt.ok((0, code_1.validateArray)(cxt));
      }
    };
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/contains.js
var require_contains = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/contains.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error = {
      message: ({ params: { min, max } }) => max === void 0 ? (0, codegen_1.str)`must contain at least ${min} valid item(s)` : (0, codegen_1.str)`must contain at least ${min} and no more than ${max} valid item(s)`,
      params: ({ params: { min, max } }) => max === void 0 ? (0, codegen_1._)`{minContains: ${min}}` : (0, codegen_1._)`{minContains: ${min}, maxContains: ${max}}`
    };
    var def = {
      keyword: "contains",
      type: "array",
      schemaType: ["object", "boolean"],
      before: "uniqueItems",
      trackErrors: true,
      error,
      code(cxt) {
        const { gen, schema, parentSchema, data, it } = cxt;
        let min;
        let max;
        const { minContains, maxContains } = parentSchema;
        if (it.opts.next) {
          min = minContains === void 0 ? 1 : minContains;
          max = maxContains;
        } else {
          min = 1;
        }
        const len = gen.const("len", (0, codegen_1._)`${data}.length`);
        cxt.setParams({ min, max });
        if (max === void 0 && min === 0) {
          (0, util_1.checkStrictMode)(it, `"minContains" == 0 without "maxContains": "contains" keyword ignored`);
          return;
        }
        if (max !== void 0 && min > max) {
          (0, util_1.checkStrictMode)(it, `"minContains" > "maxContains" is always invalid`);
          cxt.fail();
          return;
        }
        if ((0, util_1.alwaysValidSchema)(it, schema)) {
          let cond = (0, codegen_1._)`${len} >= ${min}`;
          if (max !== void 0)
            cond = (0, codegen_1._)`${cond} && ${len} <= ${max}`;
          cxt.pass(cond);
          return;
        }
        it.items = true;
        const valid = gen.name("valid");
        if (max === void 0 && min === 1) {
          validateItems(valid, () => gen.if(valid, () => gen.break()));
        } else if (min === 0) {
          gen.let(valid, true);
          if (max !== void 0)
            gen.if((0, codegen_1._)`${data}.length > 0`, validateItemsWithCount);
        } else {
          gen.let(valid, false);
          validateItemsWithCount();
        }
        cxt.result(valid, () => cxt.reset());
        function validateItemsWithCount() {
          const schValid = gen.name("_valid");
          const count = gen.let("count", 0);
          validateItems(schValid, () => gen.if(schValid, () => checkLimits(count)));
        }
        function validateItems(_valid, block) {
          gen.forRange("i", 0, len, (i) => {
            cxt.subschema({
              keyword: "contains",
              dataProp: i,
              dataPropType: util_1.Type.Num,
              compositeRule: true
            }, _valid);
            block();
          });
        }
        function checkLimits(count) {
          gen.code((0, codegen_1._)`${count}++`);
          if (max === void 0) {
            gen.if((0, codegen_1._)`${count} >= ${min}`, () => gen.assign(valid, true).break());
          } else {
            gen.if((0, codegen_1._)`${count} > ${max}`, () => gen.assign(valid, false).break());
            if (min === 1)
              gen.assign(valid, true);
            else
              gen.if((0, codegen_1._)`${count} >= ${min}`, () => gen.assign(valid, true));
          }
        }
      }
    };
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/dependencies.js
var require_dependencies = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/dependencies.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.validateSchemaDeps = exports.validatePropertyDeps = exports.error = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var code_1 = require_code2();
    exports.error = {
      message: ({ params: { property, depsCount, deps } }) => {
        const property_ies = depsCount === 1 ? "property" : "properties";
        return (0, codegen_1.str)`must have ${property_ies} ${deps} when property ${property} is present`;
      },
      params: ({ params: { property, depsCount, deps, missingProperty } }) => (0, codegen_1._)`{property: ${property},
    missingProperty: ${missingProperty},
    depsCount: ${depsCount},
    deps: ${deps}}`
      // TODO change to reference
    };
    var def = {
      keyword: "dependencies",
      type: "object",
      schemaType: "object",
      error: exports.error,
      code(cxt) {
        const [propDeps, schDeps] = splitDependencies(cxt);
        validatePropertyDeps(cxt, propDeps);
        validateSchemaDeps(cxt, schDeps);
      }
    };
    function splitDependencies({ schema }) {
      const propertyDeps = {};
      const schemaDeps = {};
      for (const key in schema) {
        if (key === "__proto__")
          continue;
        const deps = Array.isArray(schema[key]) ? propertyDeps : schemaDeps;
        deps[key] = schema[key];
      }
      return [propertyDeps, schemaDeps];
    }
    function validatePropertyDeps(cxt, propertyDeps = cxt.schema) {
      const { gen, data, it } = cxt;
      if (Object.keys(propertyDeps).length === 0)
        return;
      const missing = gen.let("missing");
      for (const prop in propertyDeps) {
        const deps = propertyDeps[prop];
        if (deps.length === 0)
          continue;
        const hasProperty = (0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties);
        cxt.setParams({
          property: prop,
          depsCount: deps.length,
          deps: deps.join(", ")
        });
        if (it.allErrors) {
          gen.if(hasProperty, () => {
            for (const depProp of deps) {
              (0, code_1.checkReportMissingProp)(cxt, depProp);
            }
          });
        } else {
          gen.if((0, codegen_1._)`${hasProperty} && (${(0, code_1.checkMissingProp)(cxt, deps, missing)})`);
          (0, code_1.reportMissingProp)(cxt, missing);
          gen.else();
        }
      }
    }
    exports.validatePropertyDeps = validatePropertyDeps;
    function validateSchemaDeps(cxt, schemaDeps = cxt.schema) {
      const { gen, data, keyword, it } = cxt;
      const valid = gen.name("valid");
      for (const prop in schemaDeps) {
        if ((0, util_1.alwaysValidSchema)(it, schemaDeps[prop]))
          continue;
        gen.if(
          (0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties),
          () => {
            const schCxt = cxt.subschema({ keyword, schemaProp: prop }, valid);
            cxt.mergeValidEvaluated(schCxt, valid);
          },
          () => gen.var(valid, true)
          // TODO var
        );
        cxt.ok(valid);
      }
    }
    exports.validateSchemaDeps = validateSchemaDeps;
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/propertyNames.js
var require_propertyNames = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/propertyNames.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error = {
      message: "property name must be valid",
      params: ({ params }) => (0, codegen_1._)`{propertyName: ${params.propertyName}}`
    };
    var def = {
      keyword: "propertyNames",
      type: "object",
      schemaType: ["object", "boolean"],
      error,
      code(cxt) {
        const { gen, schema, data, it } = cxt;
        if ((0, util_1.alwaysValidSchema)(it, schema))
          return;
        const valid = gen.name("valid");
        gen.forIn("key", data, (key) => {
          cxt.setParams({ propertyName: key });
          cxt.subschema({
            keyword: "propertyNames",
            data: key,
            dataTypes: ["string"],
            propertyName: key,
            compositeRule: true
          }, valid);
          gen.if((0, codegen_1.not)(valid), () => {
            cxt.error(true);
            if (!it.allErrors)
              gen.break();
          });
        });
        cxt.ok(valid);
      }
    };
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/additionalProperties.js
var require_additionalProperties = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/additionalProperties.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var code_1 = require_code2();
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var util_1 = require_util();
    var error = {
      message: "must NOT have additional properties",
      params: ({ params }) => (0, codegen_1._)`{additionalProperty: ${params.additionalProperty}}`
    };
    var def = {
      keyword: "additionalProperties",
      type: ["object"],
      schemaType: ["boolean", "object"],
      allowUndefined: true,
      trackErrors: true,
      error,
      code(cxt) {
        const { gen, schema, parentSchema, data, errsCount, it } = cxt;
        if (!errsCount)
          throw new Error("ajv implementation error");
        const { allErrors, opts } = it;
        it.props = true;
        if (opts.removeAdditional !== "all" && (0, util_1.alwaysValidSchema)(it, schema))
          return;
        const props = (0, code_1.allSchemaProperties)(parentSchema.properties);
        const patProps = (0, code_1.allSchemaProperties)(parentSchema.patternProperties);
        checkAdditionalProperties();
        cxt.ok((0, codegen_1._)`${errsCount} === ${names_1.default.errors}`);
        function checkAdditionalProperties() {
          gen.forIn("key", data, (key) => {
            if (!props.length && !patProps.length)
              additionalPropertyCode(key);
            else
              gen.if(isAdditional(key), () => additionalPropertyCode(key));
          });
        }
        function isAdditional(key) {
          let definedProp;
          if (props.length > 8) {
            const propsSchema = (0, util_1.schemaRefOrVal)(it, parentSchema.properties, "properties");
            definedProp = (0, code_1.isOwnProperty)(gen, propsSchema, key);
          } else if (props.length) {
            definedProp = (0, codegen_1.or)(...props.map((p) => (0, codegen_1._)`${key} === ${p}`));
          } else {
            definedProp = codegen_1.nil;
          }
          if (patProps.length) {
            definedProp = (0, codegen_1.or)(definedProp, ...patProps.map((p) => (0, codegen_1._)`${(0, code_1.usePattern)(cxt, p)}.test(${key})`));
          }
          return (0, codegen_1.not)(definedProp);
        }
        function deleteAdditional(key) {
          gen.code((0, codegen_1._)`delete ${data}[${key}]`);
        }
        function additionalPropertyCode(key) {
          if (opts.removeAdditional === "all" || opts.removeAdditional && schema === false) {
            deleteAdditional(key);
            return;
          }
          if (schema === false) {
            cxt.setParams({ additionalProperty: key });
            cxt.error();
            if (!allErrors)
              gen.break();
            return;
          }
          if (typeof schema == "object" && !(0, util_1.alwaysValidSchema)(it, schema)) {
            const valid = gen.name("valid");
            if (opts.removeAdditional === "failing") {
              applyAdditionalSchema(key, valid, false);
              gen.if((0, codegen_1.not)(valid), () => {
                cxt.reset();
                deleteAdditional(key);
              });
            } else {
              applyAdditionalSchema(key, valid);
              if (!allErrors)
                gen.if((0, codegen_1.not)(valid), () => gen.break());
            }
          }
        }
        function applyAdditionalSchema(key, valid, errors) {
          const subschema = {
            keyword: "additionalProperties",
            dataProp: key,
            dataPropType: util_1.Type.Str
          };
          if (errors === false) {
            Object.assign(subschema, {
              compositeRule: true,
              createErrors: false,
              allErrors: false
            });
          }
          cxt.subschema(subschema, valid);
        }
      }
    };
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/properties.js
var require_properties = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/properties.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var validate_1 = require_validate();
    var code_1 = require_code2();
    var util_1 = require_util();
    var additionalProperties_1 = require_additionalProperties();
    var def = {
      keyword: "properties",
      type: "object",
      schemaType: "object",
      code(cxt) {
        const { gen, schema, parentSchema, data, it } = cxt;
        if (it.opts.removeAdditional === "all" && parentSchema.additionalProperties === void 0) {
          additionalProperties_1.default.code(new validate_1.KeywordCxt(it, additionalProperties_1.default, "additionalProperties"));
        }
        const allProps = (0, code_1.allSchemaProperties)(schema);
        for (const prop of allProps) {
          it.definedProperties.add(prop);
        }
        if (it.opts.unevaluated && allProps.length && it.props !== true) {
          it.props = util_1.mergeEvaluated.props(gen, (0, util_1.toHash)(allProps), it.props);
        }
        const properties = allProps.filter((p) => !(0, util_1.alwaysValidSchema)(it, schema[p]));
        if (properties.length === 0)
          return;
        const valid = gen.name("valid");
        for (const prop of properties) {
          if (hasDefault(prop)) {
            applyPropertySchema(prop);
          } else {
            gen.if((0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties));
            applyPropertySchema(prop);
            if (!it.allErrors)
              gen.else().var(valid, true);
            gen.endIf();
          }
          cxt.it.definedProperties.add(prop);
          cxt.ok(valid);
        }
        function hasDefault(prop) {
          return it.opts.useDefaults && !it.compositeRule && schema[prop].default !== void 0;
        }
        function applyPropertySchema(prop) {
          cxt.subschema({
            keyword: "properties",
            schemaProp: prop,
            dataProp: prop
          }, valid);
        }
      }
    };
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/patternProperties.js
var require_patternProperties = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/patternProperties.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var code_1 = require_code2();
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var util_2 = require_util();
    var def = {
      keyword: "patternProperties",
      type: "object",
      schemaType: "object",
      code(cxt) {
        const { gen, schema, data, parentSchema, it } = cxt;
        const { opts } = it;
        const patterns = (0, code_1.allSchemaProperties)(schema);
        const alwaysValidPatterns = patterns.filter((p) => (0, util_1.alwaysValidSchema)(it, schema[p]));
        if (patterns.length === 0 || alwaysValidPatterns.length === patterns.length && (!it.opts.unevaluated || it.props === true)) {
          return;
        }
        const checkProperties = opts.strictSchema && !opts.allowMatchingProperties && parentSchema.properties;
        const valid = gen.name("valid");
        if (it.props !== true && !(it.props instanceof codegen_1.Name)) {
          it.props = (0, util_2.evaluatedPropsToName)(gen, it.props);
        }
        const { props } = it;
        validatePatternProperties();
        function validatePatternProperties() {
          for (const pat of patterns) {
            if (checkProperties)
              checkMatchingProperties(pat);
            if (it.allErrors) {
              validateProperties(pat);
            } else {
              gen.var(valid, true);
              validateProperties(pat);
              gen.if(valid);
            }
          }
        }
        function checkMatchingProperties(pat) {
          for (const prop in checkProperties) {
            if (new RegExp(pat).test(prop)) {
              (0, util_1.checkStrictMode)(it, `property ${prop} matches pattern ${pat} (use allowMatchingProperties)`);
            }
          }
        }
        function validateProperties(pat) {
          gen.forIn("key", data, (key) => {
            gen.if((0, codegen_1._)`${(0, code_1.usePattern)(cxt, pat)}.test(${key})`, () => {
              const alwaysValid = alwaysValidPatterns.includes(pat);
              if (!alwaysValid) {
                cxt.subschema({
                  keyword: "patternProperties",
                  schemaProp: pat,
                  dataProp: key,
                  dataPropType: util_2.Type.Str
                }, valid);
              }
              if (it.opts.unevaluated && props !== true) {
                gen.assign((0, codegen_1._)`${props}[${key}]`, true);
              } else if (!alwaysValid && !it.allErrors) {
                gen.if((0, codegen_1.not)(valid), () => gen.break());
              }
            });
          });
        }
      }
    };
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/not.js
var require_not = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/not.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var util_1 = require_util();
    var def = {
      keyword: "not",
      schemaType: ["object", "boolean"],
      trackErrors: true,
      code(cxt) {
        const { gen, schema, it } = cxt;
        if ((0, util_1.alwaysValidSchema)(it, schema)) {
          cxt.fail();
          return;
        }
        const valid = gen.name("valid");
        cxt.subschema({
          keyword: "not",
          compositeRule: true,
          createErrors: false,
          allErrors: false
        }, valid);
        cxt.failResult(valid, () => cxt.reset(), () => cxt.error());
      },
      error: { message: "must NOT be valid" }
    };
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/anyOf.js
var require_anyOf = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/anyOf.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var code_1 = require_code2();
    var def = {
      keyword: "anyOf",
      schemaType: "array",
      trackErrors: true,
      code: code_1.validateUnion,
      error: { message: "must match a schema in anyOf" }
    };
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/oneOf.js
var require_oneOf = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/oneOf.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error = {
      message: "must match exactly one schema in oneOf",
      params: ({ params }) => (0, codegen_1._)`{passingSchemas: ${params.passing}}`
    };
    var def = {
      keyword: "oneOf",
      schemaType: "array",
      trackErrors: true,
      error,
      code(cxt) {
        const { gen, schema, parentSchema, it } = cxt;
        if (!Array.isArray(schema))
          throw new Error("ajv implementation error");
        if (it.opts.discriminator && parentSchema.discriminator)
          return;
        const schArr = schema;
        const valid = gen.let("valid", false);
        const passing = gen.let("passing", null);
        const schValid = gen.name("_valid");
        cxt.setParams({ passing });
        gen.block(validateOneOf);
        cxt.result(valid, () => cxt.reset(), () => cxt.error(true));
        function validateOneOf() {
          schArr.forEach((sch, i) => {
            let schCxt;
            if ((0, util_1.alwaysValidSchema)(it, sch)) {
              gen.var(schValid, true);
            } else {
              schCxt = cxt.subschema({
                keyword: "oneOf",
                schemaProp: i,
                compositeRule: true
              }, schValid);
            }
            if (i > 0) {
              gen.if((0, codegen_1._)`${schValid} && ${valid}`).assign(valid, false).assign(passing, (0, codegen_1._)`[${passing}, ${i}]`).else();
            }
            gen.if(schValid, () => {
              gen.assign(valid, true);
              gen.assign(passing, i);
              if (schCxt)
                cxt.mergeEvaluated(schCxt, codegen_1.Name);
            });
          });
        }
      }
    };
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/allOf.js
var require_allOf = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/allOf.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var util_1 = require_util();
    var def = {
      keyword: "allOf",
      schemaType: "array",
      code(cxt) {
        const { gen, schema, it } = cxt;
        if (!Array.isArray(schema))
          throw new Error("ajv implementation error");
        const valid = gen.name("valid");
        schema.forEach((sch, i) => {
          if ((0, util_1.alwaysValidSchema)(it, sch))
            return;
          const schCxt = cxt.subschema({ keyword: "allOf", schemaProp: i }, valid);
          cxt.ok(valid);
          cxt.mergeEvaluated(schCxt);
        });
      }
    };
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/if.js
var require_if = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/if.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error = {
      message: ({ params }) => (0, codegen_1.str)`must match "${params.ifClause}" schema`,
      params: ({ params }) => (0, codegen_1._)`{failingKeyword: ${params.ifClause}}`
    };
    var def = {
      keyword: "if",
      schemaType: ["object", "boolean"],
      trackErrors: true,
      error,
      code(cxt) {
        const { gen, parentSchema, it } = cxt;
        if (parentSchema.then === void 0 && parentSchema.else === void 0) {
          (0, util_1.checkStrictMode)(it, '"if" without "then" and "else" is ignored');
        }
        const hasThen = hasSchema(it, "then");
        const hasElse = hasSchema(it, "else");
        if (!hasThen && !hasElse)
          return;
        const valid = gen.let("valid", true);
        const schValid = gen.name("_valid");
        validateIf();
        cxt.reset();
        if (hasThen && hasElse) {
          const ifClause = gen.let("ifClause");
          cxt.setParams({ ifClause });
          gen.if(schValid, validateClause("then", ifClause), validateClause("else", ifClause));
        } else if (hasThen) {
          gen.if(schValid, validateClause("then"));
        } else {
          gen.if((0, codegen_1.not)(schValid), validateClause("else"));
        }
        cxt.pass(valid, () => cxt.error(true));
        function validateIf() {
          const schCxt = cxt.subschema({
            keyword: "if",
            compositeRule: true,
            createErrors: false,
            allErrors: false
          }, schValid);
          cxt.mergeEvaluated(schCxt);
        }
        function validateClause(keyword, ifClause) {
          return () => {
            const schCxt = cxt.subschema({ keyword }, schValid);
            gen.assign(valid, schValid);
            cxt.mergeValidEvaluated(schCxt, valid);
            if (ifClause)
              gen.assign(ifClause, (0, codegen_1._)`${keyword}`);
            else
              cxt.setParams({ ifClause: keyword });
          };
        }
      }
    };
    function hasSchema(it, keyword) {
      const schema = it.schema[keyword];
      return schema !== void 0 && !(0, util_1.alwaysValidSchema)(it, schema);
    }
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/thenElse.js
var require_thenElse = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/thenElse.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var util_1 = require_util();
    var def = {
      keyword: ["then", "else"],
      schemaType: ["object", "boolean"],
      code({ keyword, parentSchema, it }) {
        if (parentSchema.if === void 0)
          (0, util_1.checkStrictMode)(it, `"${keyword}" without "if" is ignored`);
      }
    };
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/index.js
var require_applicator = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/applicator/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var additionalItems_1 = require_additionalItems();
    var prefixItems_1 = require_prefixItems();
    var items_1 = require_items();
    var items2020_1 = require_items2020();
    var contains_1 = require_contains();
    var dependencies_1 = require_dependencies();
    var propertyNames_1 = require_propertyNames();
    var additionalProperties_1 = require_additionalProperties();
    var properties_1 = require_properties();
    var patternProperties_1 = require_patternProperties();
    var not_1 = require_not();
    var anyOf_1 = require_anyOf();
    var oneOf_1 = require_oneOf();
    var allOf_1 = require_allOf();
    var if_1 = require_if();
    var thenElse_1 = require_thenElse();
    function getApplicator(draft2020 = false) {
      const applicator = [
        // any
        not_1.default,
        anyOf_1.default,
        oneOf_1.default,
        allOf_1.default,
        if_1.default,
        thenElse_1.default,
        // object
        propertyNames_1.default,
        additionalProperties_1.default,
        dependencies_1.default,
        properties_1.default,
        patternProperties_1.default
      ];
      if (draft2020)
        applicator.push(prefixItems_1.default, items2020_1.default);
      else
        applicator.push(additionalItems_1.default, items_1.default);
      applicator.push(contains_1.default);
      return applicator;
    }
    exports.default = getApplicator;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/format/format.js
var require_format = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/format/format.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var error = {
      message: ({ schemaCode }) => (0, codegen_1.str)`must match format "${schemaCode}"`,
      params: ({ schemaCode }) => (0, codegen_1._)`{format: ${schemaCode}}`
    };
    var def = {
      keyword: "format",
      type: ["number", "string"],
      schemaType: "string",
      $data: true,
      error,
      code(cxt, ruleType) {
        const { gen, data, $data, schema, schemaCode, it } = cxt;
        const { opts, errSchemaPath, schemaEnv, self } = it;
        if (!opts.validateFormats)
          return;
        if ($data)
          validate$DataFormat();
        else
          validateFormat();
        function validate$DataFormat() {
          const fmts = gen.scopeValue("formats", {
            ref: self.formats,
            code: opts.code.formats
          });
          const fDef = gen.const("fDef", (0, codegen_1._)`${fmts}[${schemaCode}]`);
          const fType = gen.let("fType");
          const format = gen.let("format");
          gen.if((0, codegen_1._)`typeof ${fDef} == "object" && !(${fDef} instanceof RegExp)`, () => gen.assign(fType, (0, codegen_1._)`${fDef}.type || "string"`).assign(format, (0, codegen_1._)`${fDef}.validate`), () => gen.assign(fType, (0, codegen_1._)`"string"`).assign(format, fDef));
          cxt.fail$data((0, codegen_1.or)(unknownFmt(), invalidFmt()));
          function unknownFmt() {
            if (opts.strictSchema === false)
              return codegen_1.nil;
            return (0, codegen_1._)`${schemaCode} && !${format}`;
          }
          function invalidFmt() {
            const callFormat = schemaEnv.$async ? (0, codegen_1._)`(${fDef}.async ? await ${format}(${data}) : ${format}(${data}))` : (0, codegen_1._)`${format}(${data})`;
            const validData = (0, codegen_1._)`(typeof ${format} == "function" ? ${callFormat} : ${format}.test(${data}))`;
            return (0, codegen_1._)`${format} && ${format} !== true && ${fType} === ${ruleType} && !${validData}`;
          }
        }
        function validateFormat() {
          const formatDef = self.formats[schema];
          if (!formatDef) {
            unknownFormat();
            return;
          }
          if (formatDef === true)
            return;
          const [fmtType, format, fmtRef] = getFormat(formatDef);
          if (fmtType === ruleType)
            cxt.pass(validCondition());
          function unknownFormat() {
            if (opts.strictSchema === false) {
              self.logger.warn(unknownMsg());
              return;
            }
            throw new Error(unknownMsg());
            function unknownMsg() {
              return `unknown format "${schema}" ignored in schema at path "${errSchemaPath}"`;
            }
          }
          function getFormat(fmtDef) {
            const code = fmtDef instanceof RegExp ? (0, codegen_1.regexpCode)(fmtDef) : opts.code.formats ? (0, codegen_1._)`${opts.code.formats}${(0, codegen_1.getProperty)(schema)}` : void 0;
            const fmt = gen.scopeValue("formats", { key: schema, ref: fmtDef, code });
            if (typeof fmtDef == "object" && !(fmtDef instanceof RegExp)) {
              return [fmtDef.type || "string", fmtDef.validate, (0, codegen_1._)`${fmt}.validate`];
            }
            return ["string", fmtDef, fmt];
          }
          function validCondition() {
            if (typeof formatDef == "object" && !(formatDef instanceof RegExp) && formatDef.async) {
              if (!schemaEnv.$async)
                throw new Error("async format in sync schema");
              return (0, codegen_1._)`await ${fmtRef}(${data})`;
            }
            return typeof format == "function" ? (0, codegen_1._)`${fmtRef}(${data})` : (0, codegen_1._)`${fmtRef}.test(${data})`;
          }
        }
      }
    };
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/format/index.js
var require_format2 = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/format/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var format_1 = require_format();
    var format = [format_1.default];
    exports.default = format;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/metadata.js
var require_metadata = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/metadata.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.contentVocabulary = exports.metadataVocabulary = void 0;
    exports.metadataVocabulary = [
      "title",
      "description",
      "default",
      "deprecated",
      "readOnly",
      "writeOnly",
      "examples"
    ];
    exports.contentVocabulary = [
      "contentMediaType",
      "contentEncoding",
      "contentSchema"
    ];
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/draft7.js
var require_draft7 = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/draft7.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var core_1 = require_core2();
    var validation_1 = require_validation();
    var applicator_1 = require_applicator();
    var format_1 = require_format2();
    var metadata_1 = require_metadata();
    var draft7Vocabularies = [
      core_1.default,
      validation_1.default,
      (0, applicator_1.default)(),
      format_1.default,
      metadata_1.metadataVocabulary,
      metadata_1.contentVocabulary
    ];
    exports.default = draft7Vocabularies;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/discriminator/types.js
var require_types = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/discriminator/types.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.DiscrError = void 0;
    var DiscrError;
    (function(DiscrError2) {
      DiscrError2["Tag"] = "tag";
      DiscrError2["Mapping"] = "mapping";
    })(DiscrError || (exports.DiscrError = DiscrError = {}));
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/discriminator/index.js
var require_discriminator = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/vocabularies/discriminator/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var types_1 = require_types();
    var compile_1 = require_compile();
    var ref_error_1 = require_ref_error();
    var util_1 = require_util();
    var error = {
      message: ({ params: { discrError, tagName } }) => discrError === types_1.DiscrError.Tag ? `tag "${tagName}" must be string` : `value of tag "${tagName}" must be in oneOf`,
      params: ({ params: { discrError, tag, tagName } }) => (0, codegen_1._)`{error: ${discrError}, tag: ${tagName}, tagValue: ${tag}}`
    };
    var def = {
      keyword: "discriminator",
      type: "object",
      schemaType: "object",
      error,
      code(cxt) {
        const { gen, data, schema, parentSchema, it } = cxt;
        const { oneOf } = parentSchema;
        if (!it.opts.discriminator) {
          throw new Error("discriminator: requires discriminator option");
        }
        const tagName = schema.propertyName;
        if (typeof tagName != "string")
          throw new Error("discriminator: requires propertyName");
        if (schema.mapping)
          throw new Error("discriminator: mapping is not supported");
        if (!oneOf)
          throw new Error("discriminator: requires oneOf keyword");
        const valid = gen.let("valid", false);
        const tag = gen.const("tag", (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(tagName)}`);
        gen.if((0, codegen_1._)`typeof ${tag} == "string"`, () => validateMapping(), () => cxt.error(false, { discrError: types_1.DiscrError.Tag, tag, tagName }));
        cxt.ok(valid);
        function validateMapping() {
          const mapping = getMapping();
          gen.if(false);
          for (const tagValue in mapping) {
            gen.elseIf((0, codegen_1._)`${tag} === ${tagValue}`);
            gen.assign(valid, applyTagSchema(mapping[tagValue]));
          }
          gen.else();
          cxt.error(false, { discrError: types_1.DiscrError.Mapping, tag, tagName });
          gen.endIf();
        }
        function applyTagSchema(schemaProp) {
          const _valid = gen.name("valid");
          const schCxt = cxt.subschema({ keyword: "oneOf", schemaProp }, _valid);
          cxt.mergeEvaluated(schCxt, codegen_1.Name);
          return _valid;
        }
        function getMapping() {
          var _a;
          const oneOfMapping = {};
          const topRequired = hasRequired(parentSchema);
          let tagRequired = true;
          for (let i = 0; i < oneOf.length; i++) {
            let sch = oneOf[i];
            if ((sch === null || sch === void 0 ? void 0 : sch.$ref) && !(0, util_1.schemaHasRulesButRef)(sch, it.self.RULES)) {
              const ref = sch.$ref;
              sch = compile_1.resolveRef.call(it.self, it.schemaEnv.root, it.baseId, ref);
              if (sch instanceof compile_1.SchemaEnv)
                sch = sch.schema;
              if (sch === void 0)
                throw new ref_error_1.default(it.opts.uriResolver, it.baseId, ref);
            }
            const propSch = (_a = sch === null || sch === void 0 ? void 0 : sch.properties) === null || _a === void 0 ? void 0 : _a[tagName];
            if (typeof propSch != "object") {
              throw new Error(`discriminator: oneOf subschemas (or referenced schemas) must have "properties/${tagName}"`);
            }
            tagRequired = tagRequired && (topRequired || hasRequired(sch));
            addMappings(propSch, i);
          }
          if (!tagRequired)
            throw new Error(`discriminator: "${tagName}" must be required`);
          return oneOfMapping;
          function hasRequired({ required: required2 }) {
            return Array.isArray(required2) && required2.includes(tagName);
          }
          function addMappings(sch, i) {
            if (sch.const) {
              addMapping(sch.const, i);
            } else if (sch.enum) {
              for (const tagValue of sch.enum) {
                addMapping(tagValue, i);
              }
            } else {
              throw new Error(`discriminator: "properties/${tagName}" must have "const" or "enum"`);
            }
          }
          function addMapping(tagValue, i) {
            if (typeof tagValue != "string" || tagValue in oneOfMapping) {
              throw new Error(`discriminator: "${tagName}" values must be unique strings`);
            }
            oneOfMapping[tagValue] = i;
          }
        }
      }
    };
    exports.default = def;
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/refs/json-schema-draft-07.json
var require_json_schema_draft_07 = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/refs/json-schema-draft-07.json"(exports, module) {
    module.exports = {
      $schema: "http://json-schema.org/draft-07/schema#",
      $id: "http://json-schema.org/draft-07/schema#",
      title: "Core schema meta-schema",
      definitions: {
        schemaArray: {
          type: "array",
          minItems: 1,
          items: { $ref: "#" }
        },
        nonNegativeInteger: {
          type: "integer",
          minimum: 0
        },
        nonNegativeIntegerDefault0: {
          allOf: [{ $ref: "#/definitions/nonNegativeInteger" }, { default: 0 }]
        },
        simpleTypes: {
          enum: ["array", "boolean", "integer", "null", "number", "object", "string"]
        },
        stringArray: {
          type: "array",
          items: { type: "string" },
          uniqueItems: true,
          default: []
        }
      },
      type: ["object", "boolean"],
      properties: {
        $id: {
          type: "string",
          format: "uri-reference"
        },
        $schema: {
          type: "string",
          format: "uri"
        },
        $ref: {
          type: "string",
          format: "uri-reference"
        },
        $comment: {
          type: "string"
        },
        title: {
          type: "string"
        },
        description: {
          type: "string"
        },
        default: true,
        readOnly: {
          type: "boolean",
          default: false
        },
        examples: {
          type: "array",
          items: true
        },
        multipleOf: {
          type: "number",
          exclusiveMinimum: 0
        },
        maximum: {
          type: "number"
        },
        exclusiveMaximum: {
          type: "number"
        },
        minimum: {
          type: "number"
        },
        exclusiveMinimum: {
          type: "number"
        },
        maxLength: { $ref: "#/definitions/nonNegativeInteger" },
        minLength: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
        pattern: {
          type: "string",
          format: "regex"
        },
        additionalItems: { $ref: "#" },
        items: {
          anyOf: [{ $ref: "#" }, { $ref: "#/definitions/schemaArray" }],
          default: true
        },
        maxItems: { $ref: "#/definitions/nonNegativeInteger" },
        minItems: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
        uniqueItems: {
          type: "boolean",
          default: false
        },
        contains: { $ref: "#" },
        maxProperties: { $ref: "#/definitions/nonNegativeInteger" },
        minProperties: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
        required: { $ref: "#/definitions/stringArray" },
        additionalProperties: { $ref: "#" },
        definitions: {
          type: "object",
          additionalProperties: { $ref: "#" },
          default: {}
        },
        properties: {
          type: "object",
          additionalProperties: { $ref: "#" },
          default: {}
        },
        patternProperties: {
          type: "object",
          additionalProperties: { $ref: "#" },
          propertyNames: { format: "regex" },
          default: {}
        },
        dependencies: {
          type: "object",
          additionalProperties: {
            anyOf: [{ $ref: "#" }, { $ref: "#/definitions/stringArray" }]
          }
        },
        propertyNames: { $ref: "#" },
        const: true,
        enum: {
          type: "array",
          items: true,
          minItems: 1,
          uniqueItems: true
        },
        type: {
          anyOf: [
            { $ref: "#/definitions/simpleTypes" },
            {
              type: "array",
              items: { $ref: "#/definitions/simpleTypes" },
              minItems: 1,
              uniqueItems: true
            }
          ]
        },
        format: { type: "string" },
        contentMediaType: { type: "string" },
        contentEncoding: { type: "string" },
        if: { $ref: "#" },
        then: { $ref: "#" },
        else: { $ref: "#" },
        allOf: { $ref: "#/definitions/schemaArray" },
        anyOf: { $ref: "#/definitions/schemaArray" },
        oneOf: { $ref: "#/definitions/schemaArray" },
        not: { $ref: "#" }
      },
      default: true
    };
  }
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/ajv.js
var require_ajv = __commonJS({
  "../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/ajv/dist/ajv.js"(exports, module) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MissingRefError = exports.ValidationError = exports.CodeGen = exports.Name = exports.nil = exports.stringify = exports.str = exports._ = exports.KeywordCxt = exports.Ajv = void 0;
    var core_1 = require_core();
    var draft7_1 = require_draft7();
    var discriminator_1 = require_discriminator();
    var draft7MetaSchema = require_json_schema_draft_07();
    var META_SUPPORT_DATA = ["/properties"];
    var META_SCHEMA_ID = "http://json-schema.org/draft-07/schema";
    var Ajv5 = class extends core_1.default {
      _addVocabularies() {
        super._addVocabularies();
        draft7_1.default.forEach((v) => this.addVocabulary(v));
        if (this.opts.discriminator)
          this.addKeyword(discriminator_1.default);
      }
      _addDefaultMetaSchema() {
        super._addDefaultMetaSchema();
        if (!this.opts.meta)
          return;
        const metaSchema = this.opts.$data ? this.$dataMetaSchema(draft7MetaSchema, META_SUPPORT_DATA) : draft7MetaSchema;
        this.addMetaSchema(metaSchema, META_SCHEMA_ID, false);
        this.refs["http://json-schema.org/schema"] = META_SCHEMA_ID;
      }
      defaultMeta() {
        return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(META_SCHEMA_ID) ? META_SCHEMA_ID : void 0);
      }
    };
    exports.Ajv = Ajv5;
    module.exports = exports = Ajv5;
    module.exports.Ajv = Ajv5;
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = Ajv5;
    var validate_1 = require_validate();
    Object.defineProperty(exports, "KeywordCxt", { enumerable: true, get: function() {
      return validate_1.KeywordCxt;
    } });
    var codegen_1 = require_codegen();
    Object.defineProperty(exports, "_", { enumerable: true, get: function() {
      return codegen_1._;
    } });
    Object.defineProperty(exports, "str", { enumerable: true, get: function() {
      return codegen_1.str;
    } });
    Object.defineProperty(exports, "stringify", { enumerable: true, get: function() {
      return codegen_1.stringify;
    } });
    Object.defineProperty(exports, "nil", { enumerable: true, get: function() {
      return codegen_1.nil;
    } });
    Object.defineProperty(exports, "Name", { enumerable: true, get: function() {
      return codegen_1.Name;
    } });
    Object.defineProperty(exports, "CodeGen", { enumerable: true, get: function() {
      return codegen_1.CodeGen;
    } });
    var validation_error_1 = require_validation_error();
    Object.defineProperty(exports, "ValidationError", { enumerable: true, get: function() {
      return validation_error_1.default;
    } });
    var ref_error_1 = require_ref_error();
    Object.defineProperty(exports, "MissingRefError", { enumerable: true, get: function() {
      return ref_error_1.default;
    } });
  }
});

// src/cli.ts
import { realpathSync as realpathSync5 } from "node:fs";
import { isAbsolute as isAbsolute7, normalize as normalize4, resolve as resolve4 } from "node:path";
import { pathToFileURL } from "node:url";

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/guard/value.mjs
var value_exports = {};
__export(value_exports, {
  HasPropertyKey: () => HasPropertyKey,
  IsArray: () => IsArray,
  IsAsyncIterator: () => IsAsyncIterator,
  IsBigInt: () => IsBigInt,
  IsBoolean: () => IsBoolean,
  IsDate: () => IsDate,
  IsFunction: () => IsFunction,
  IsIterator: () => IsIterator,
  IsNull: () => IsNull,
  IsNumber: () => IsNumber,
  IsObject: () => IsObject,
  IsRegExp: () => IsRegExp,
  IsString: () => IsString,
  IsSymbol: () => IsSymbol,
  IsUint8Array: () => IsUint8Array,
  IsUndefined: () => IsUndefined
});
function HasPropertyKey(value, key) {
  return key in value;
}
function IsAsyncIterator(value) {
  return IsObject(value) && !IsArray(value) && !IsUint8Array(value) && Symbol.asyncIterator in value;
}
function IsArray(value) {
  return Array.isArray(value);
}
function IsBigInt(value) {
  return typeof value === "bigint";
}
function IsBoolean(value) {
  return typeof value === "boolean";
}
function IsDate(value) {
  return value instanceof globalThis.Date;
}
function IsFunction(value) {
  return typeof value === "function";
}
function IsIterator(value) {
  return IsObject(value) && !IsArray(value) && !IsUint8Array(value) && Symbol.iterator in value;
}
function IsNull(value) {
  return value === null;
}
function IsNumber(value) {
  return typeof value === "number";
}
function IsObject(value) {
  return typeof value === "object" && value !== null;
}
function IsRegExp(value) {
  return value instanceof globalThis.RegExp;
}
function IsString(value) {
  return typeof value === "string";
}
function IsSymbol(value) {
  return typeof value === "symbol";
}
function IsUint8Array(value) {
  return value instanceof globalThis.Uint8Array;
}
function IsUndefined(value) {
  return value === void 0;
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/clone/value.mjs
function ArrayType(value) {
  return value.map((value2) => Visit(value2));
}
function DateType(value) {
  return new Date(value.getTime());
}
function Uint8ArrayType(value) {
  return new Uint8Array(value);
}
function RegExpType(value) {
  return new RegExp(value.source, value.flags);
}
function ObjectType(value) {
  const result2 = {};
  for (const key of Object.getOwnPropertyNames(value)) {
    result2[key] = Visit(value[key]);
  }
  for (const key of Object.getOwnPropertySymbols(value)) {
    result2[key] = Visit(value[key]);
  }
  return result2;
}
function Visit(value) {
  return IsArray(value) ? ArrayType(value) : IsDate(value) ? DateType(value) : IsUint8Array(value) ? Uint8ArrayType(value) : IsRegExp(value) ? RegExpType(value) : IsObject(value) ? ObjectType(value) : value;
}
function Clone(value) {
  return Visit(value);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/clone/type.mjs
function CloneType(schema, options) {
  return options === void 0 ? Clone(schema) : Clone({ ...options, ...schema });
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/value/guard/guard.mjs
function IsObject2(value) {
  return value !== null && typeof value === "object";
}
function IsArray2(value) {
  return globalThis.Array.isArray(value) && !globalThis.ArrayBuffer.isView(value);
}
function IsUndefined2(value) {
  return value === void 0;
}
function IsNumber2(value) {
  return typeof value === "number";
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/system/policy.mjs
var TypeSystemPolicy;
(function(TypeSystemPolicy2) {
  TypeSystemPolicy2.InstanceMode = "default";
  TypeSystemPolicy2.ExactOptionalPropertyTypes = false;
  TypeSystemPolicy2.AllowArrayObject = false;
  TypeSystemPolicy2.AllowNaN = false;
  TypeSystemPolicy2.AllowNullVoid = false;
  function IsExactOptionalProperty(value, key) {
    return TypeSystemPolicy2.ExactOptionalPropertyTypes ? key in value : value[key] !== void 0;
  }
  TypeSystemPolicy2.IsExactOptionalProperty = IsExactOptionalProperty;
  function IsObjectLike(value) {
    const isObject = IsObject2(value);
    return TypeSystemPolicy2.AllowArrayObject ? isObject : isObject && !IsArray2(value);
  }
  TypeSystemPolicy2.IsObjectLike = IsObjectLike;
  function IsRecordLike(value) {
    return IsObjectLike(value) && !(value instanceof Date) && !(value instanceof Uint8Array);
  }
  TypeSystemPolicy2.IsRecordLike = IsRecordLike;
  function IsNumberLike(value) {
    return TypeSystemPolicy2.AllowNaN ? IsNumber2(value) : Number.isFinite(value);
  }
  TypeSystemPolicy2.IsNumberLike = IsNumberLike;
  function IsVoidLike(value) {
    const isUndefined = IsUndefined2(value);
    return TypeSystemPolicy2.AllowNullVoid ? isUndefined || value === null : isUndefined;
  }
  TypeSystemPolicy2.IsVoidLike = IsVoidLike;
})(TypeSystemPolicy || (TypeSystemPolicy = {}));

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/create/immutable.mjs
function ImmutableArray(value) {
  return globalThis.Object.freeze(value).map((value2) => Immutable(value2));
}
function ImmutableDate(value) {
  return value;
}
function ImmutableUint8Array(value) {
  return value;
}
function ImmutableRegExp(value) {
  return value;
}
function ImmutableObject(value) {
  const result2 = {};
  for (const key of Object.getOwnPropertyNames(value)) {
    result2[key] = Immutable(value[key]);
  }
  for (const key of Object.getOwnPropertySymbols(value)) {
    result2[key] = Immutable(value[key]);
  }
  return globalThis.Object.freeze(result2);
}
function Immutable(value) {
  return IsArray(value) ? ImmutableArray(value) : IsDate(value) ? ImmutableDate(value) : IsUint8Array(value) ? ImmutableUint8Array(value) : IsRegExp(value) ? ImmutableRegExp(value) : IsObject(value) ? ImmutableObject(value) : value;
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/create/type.mjs
function CreateType(schema, options) {
  const result2 = options !== void 0 ? { ...options, ...schema } : schema;
  switch (TypeSystemPolicy.InstanceMode) {
    case "freeze":
      return Immutable(result2);
    case "clone":
      return Clone(result2);
    default:
      return result2;
  }
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/error/error.mjs
var TypeBoxError = class extends Error {
  constructor(message) {
    super(message);
  }
};

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/symbols/symbols.mjs
var TransformKind = /* @__PURE__ */ Symbol.for("TypeBox.Transform");
var ReadonlyKind = /* @__PURE__ */ Symbol.for("TypeBox.Readonly");
var OptionalKind = /* @__PURE__ */ Symbol.for("TypeBox.Optional");
var Hint = /* @__PURE__ */ Symbol.for("TypeBox.Hint");
var Kind = /* @__PURE__ */ Symbol.for("TypeBox.Kind");

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/guard/kind.mjs
function IsReadonly(value) {
  return IsObject(value) && value[ReadonlyKind] === "Readonly";
}
function IsOptional(value) {
  return IsObject(value) && value[OptionalKind] === "Optional";
}
function IsAny(value) {
  return IsKindOf(value, "Any");
}
function IsArgument(value) {
  return IsKindOf(value, "Argument");
}
function IsArray3(value) {
  return IsKindOf(value, "Array");
}
function IsAsyncIterator2(value) {
  return IsKindOf(value, "AsyncIterator");
}
function IsBigInt2(value) {
  return IsKindOf(value, "BigInt");
}
function IsBoolean2(value) {
  return IsKindOf(value, "Boolean");
}
function IsComputed(value) {
  return IsKindOf(value, "Computed");
}
function IsConstructor(value) {
  return IsKindOf(value, "Constructor");
}
function IsDate2(value) {
  return IsKindOf(value, "Date");
}
function IsFunction2(value) {
  return IsKindOf(value, "Function");
}
function IsInteger(value) {
  return IsKindOf(value, "Integer");
}
function IsIntersect(value) {
  return IsKindOf(value, "Intersect");
}
function IsIterator2(value) {
  return IsKindOf(value, "Iterator");
}
function IsKindOf(value, kind) {
  return IsObject(value) && Kind in value && value[Kind] === kind;
}
function IsLiteralValue(value) {
  return IsBoolean(value) || IsNumber(value) || IsString(value);
}
function IsLiteral(value) {
  return IsKindOf(value, "Literal");
}
function IsMappedKey(value) {
  return IsKindOf(value, "MappedKey");
}
function IsMappedResult(value) {
  return IsKindOf(value, "MappedResult");
}
function IsNever(value) {
  return IsKindOf(value, "Never");
}
function IsNot(value) {
  return IsKindOf(value, "Not");
}
function IsNull2(value) {
  return IsKindOf(value, "Null");
}
function IsNumber3(value) {
  return IsKindOf(value, "Number");
}
function IsObject3(value) {
  return IsKindOf(value, "Object");
}
function IsPromise(value) {
  return IsKindOf(value, "Promise");
}
function IsRecord(value) {
  return IsKindOf(value, "Record");
}
function IsRef(value) {
  return IsKindOf(value, "Ref");
}
function IsRegExp2(value) {
  return IsKindOf(value, "RegExp");
}
function IsString2(value) {
  return IsKindOf(value, "String");
}
function IsSymbol2(value) {
  return IsKindOf(value, "Symbol");
}
function IsTemplateLiteral(value) {
  return IsKindOf(value, "TemplateLiteral");
}
function IsThis(value) {
  return IsKindOf(value, "This");
}
function IsTransform(value) {
  return IsObject(value) && TransformKind in value;
}
function IsTuple(value) {
  return IsKindOf(value, "Tuple");
}
function IsUndefined3(value) {
  return IsKindOf(value, "Undefined");
}
function IsUnion(value) {
  return IsKindOf(value, "Union");
}
function IsUint8Array2(value) {
  return IsKindOf(value, "Uint8Array");
}
function IsUnknown(value) {
  return IsKindOf(value, "Unknown");
}
function IsUnsafe(value) {
  return IsKindOf(value, "Unsafe");
}
function IsVoid(value) {
  return IsKindOf(value, "Void");
}
function IsKind(value) {
  return IsObject(value) && Kind in value && IsString(value[Kind]);
}
function IsSchema(value) {
  return IsAny(value) || IsArgument(value) || IsArray3(value) || IsBoolean2(value) || IsBigInt2(value) || IsAsyncIterator2(value) || IsComputed(value) || IsConstructor(value) || IsDate2(value) || IsFunction2(value) || IsInteger(value) || IsIntersect(value) || IsIterator2(value) || IsLiteral(value) || IsMappedKey(value) || IsMappedResult(value) || IsNever(value) || IsNot(value) || IsNull2(value) || IsNumber3(value) || IsObject3(value) || IsPromise(value) || IsRecord(value) || IsRef(value) || IsRegExp2(value) || IsString2(value) || IsSymbol2(value) || IsTemplateLiteral(value) || IsThis(value) || IsTuple(value) || IsUndefined3(value) || IsUnion(value) || IsUint8Array2(value) || IsUnknown(value) || IsUnsafe(value) || IsVoid(value) || IsKind(value);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/guard/type.mjs
var type_exports = {};
__export(type_exports, {
  IsAny: () => IsAny2,
  IsArgument: () => IsArgument2,
  IsArray: () => IsArray4,
  IsAsyncIterator: () => IsAsyncIterator3,
  IsBigInt: () => IsBigInt3,
  IsBoolean: () => IsBoolean3,
  IsComputed: () => IsComputed2,
  IsConstructor: () => IsConstructor2,
  IsDate: () => IsDate3,
  IsFunction: () => IsFunction3,
  IsImport: () => IsImport,
  IsInteger: () => IsInteger2,
  IsIntersect: () => IsIntersect2,
  IsIterator: () => IsIterator3,
  IsKind: () => IsKind2,
  IsKindOf: () => IsKindOf2,
  IsLiteral: () => IsLiteral2,
  IsLiteralBoolean: () => IsLiteralBoolean,
  IsLiteralNumber: () => IsLiteralNumber,
  IsLiteralString: () => IsLiteralString,
  IsLiteralValue: () => IsLiteralValue2,
  IsMappedKey: () => IsMappedKey2,
  IsMappedResult: () => IsMappedResult2,
  IsNever: () => IsNever2,
  IsNot: () => IsNot2,
  IsNull: () => IsNull3,
  IsNumber: () => IsNumber4,
  IsObject: () => IsObject4,
  IsOptional: () => IsOptional2,
  IsPromise: () => IsPromise2,
  IsProperties: () => IsProperties,
  IsReadonly: () => IsReadonly2,
  IsRecord: () => IsRecord2,
  IsRecursive: () => IsRecursive,
  IsRef: () => IsRef2,
  IsRegExp: () => IsRegExp3,
  IsSchema: () => IsSchema2,
  IsString: () => IsString3,
  IsSymbol: () => IsSymbol3,
  IsTemplateLiteral: () => IsTemplateLiteral2,
  IsThis: () => IsThis2,
  IsTransform: () => IsTransform2,
  IsTuple: () => IsTuple2,
  IsUint8Array: () => IsUint8Array3,
  IsUndefined: () => IsUndefined4,
  IsUnion: () => IsUnion2,
  IsUnionLiteral: () => IsUnionLiteral,
  IsUnknown: () => IsUnknown2,
  IsUnsafe: () => IsUnsafe2,
  IsVoid: () => IsVoid2,
  TypeGuardUnknownTypeError: () => TypeGuardUnknownTypeError
});
var TypeGuardUnknownTypeError = class extends TypeBoxError {
};
var KnownTypes = [
  "Argument",
  "Any",
  "Array",
  "AsyncIterator",
  "BigInt",
  "Boolean",
  "Computed",
  "Constructor",
  "Date",
  "Enum",
  "Function",
  "Integer",
  "Intersect",
  "Iterator",
  "Literal",
  "MappedKey",
  "MappedResult",
  "Not",
  "Null",
  "Number",
  "Object",
  "Promise",
  "Record",
  "Ref",
  "RegExp",
  "String",
  "Symbol",
  "TemplateLiteral",
  "This",
  "Tuple",
  "Undefined",
  "Union",
  "Uint8Array",
  "Unknown",
  "Void"
];
function IsPattern(value) {
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
}
function IsControlCharacterFree(value) {
  if (!IsString(value))
    return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 7 && code <= 13 || code === 27 || code === 127) {
      return false;
    }
  }
  return true;
}
function IsAdditionalProperties(value) {
  return IsOptionalBoolean(value) || IsSchema2(value);
}
function IsOptionalBigInt(value) {
  return IsUndefined(value) || IsBigInt(value);
}
function IsOptionalNumber(value) {
  return IsUndefined(value) || IsNumber(value);
}
function IsOptionalBoolean(value) {
  return IsUndefined(value) || IsBoolean(value);
}
function IsOptionalString(value) {
  return IsUndefined(value) || IsString(value);
}
function IsOptionalPattern(value) {
  return IsUndefined(value) || IsString(value) && IsControlCharacterFree(value) && IsPattern(value);
}
function IsOptionalFormat(value) {
  return IsUndefined(value) || IsString(value) && IsControlCharacterFree(value);
}
function IsOptionalSchema(value) {
  return IsUndefined(value) || IsSchema2(value);
}
function IsReadonly2(value) {
  return IsObject(value) && value[ReadonlyKind] === "Readonly";
}
function IsOptional2(value) {
  return IsObject(value) && value[OptionalKind] === "Optional";
}
function IsAny2(value) {
  return IsKindOf2(value, "Any") && IsOptionalString(value.$id);
}
function IsArgument2(value) {
  return IsKindOf2(value, "Argument") && IsNumber(value.index);
}
function IsArray4(value) {
  return IsKindOf2(value, "Array") && value.type === "array" && IsOptionalString(value.$id) && IsSchema2(value.items) && IsOptionalNumber(value.minItems) && IsOptionalNumber(value.maxItems) && IsOptionalBoolean(value.uniqueItems) && IsOptionalSchema(value.contains) && IsOptionalNumber(value.minContains) && IsOptionalNumber(value.maxContains);
}
function IsAsyncIterator3(value) {
  return IsKindOf2(value, "AsyncIterator") && value.type === "AsyncIterator" && IsOptionalString(value.$id) && IsSchema2(value.items);
}
function IsBigInt3(value) {
  return IsKindOf2(value, "BigInt") && value.type === "bigint" && IsOptionalString(value.$id) && IsOptionalBigInt(value.exclusiveMaximum) && IsOptionalBigInt(value.exclusiveMinimum) && IsOptionalBigInt(value.maximum) && IsOptionalBigInt(value.minimum) && IsOptionalBigInt(value.multipleOf);
}
function IsBoolean3(value) {
  return IsKindOf2(value, "Boolean") && value.type === "boolean" && IsOptionalString(value.$id);
}
function IsComputed2(value) {
  return IsKindOf2(value, "Computed") && IsString(value.target) && IsArray(value.parameters) && value.parameters.every((schema) => IsSchema2(schema));
}
function IsConstructor2(value) {
  return IsKindOf2(value, "Constructor") && value.type === "Constructor" && IsOptionalString(value.$id) && IsArray(value.parameters) && value.parameters.every((schema) => IsSchema2(schema)) && IsSchema2(value.returns);
}
function IsDate3(value) {
  return IsKindOf2(value, "Date") && value.type === "Date" && IsOptionalString(value.$id) && IsOptionalNumber(value.exclusiveMaximumTimestamp) && IsOptionalNumber(value.exclusiveMinimumTimestamp) && IsOptionalNumber(value.maximumTimestamp) && IsOptionalNumber(value.minimumTimestamp) && IsOptionalNumber(value.multipleOfTimestamp);
}
function IsFunction3(value) {
  return IsKindOf2(value, "Function") && value.type === "Function" && IsOptionalString(value.$id) && IsArray(value.parameters) && value.parameters.every((schema) => IsSchema2(schema)) && IsSchema2(value.returns);
}
function IsImport(value) {
  return IsKindOf2(value, "Import") && HasPropertyKey(value, "$defs") && IsObject(value.$defs) && IsProperties(value.$defs) && HasPropertyKey(value, "$ref") && IsString(value.$ref) && value.$ref in value.$defs;
}
function IsInteger2(value) {
  return IsKindOf2(value, "Integer") && value.type === "integer" && IsOptionalString(value.$id) && IsOptionalNumber(value.exclusiveMaximum) && IsOptionalNumber(value.exclusiveMinimum) && IsOptionalNumber(value.maximum) && IsOptionalNumber(value.minimum) && IsOptionalNumber(value.multipleOf);
}
function IsProperties(value) {
  return IsObject(value) && Object.entries(value).every(([key, schema]) => IsControlCharacterFree(key) && IsSchema2(schema));
}
function IsIntersect2(value) {
  return IsKindOf2(value, "Intersect") && (IsString(value.type) && value.type !== "object" ? false : true) && IsArray(value.allOf) && value.allOf.every((schema) => IsSchema2(schema) && !IsTransform2(schema)) && IsOptionalString(value.type) && (IsOptionalBoolean(value.unevaluatedProperties) || IsOptionalSchema(value.unevaluatedProperties)) && IsOptionalString(value.$id);
}
function IsIterator3(value) {
  return IsKindOf2(value, "Iterator") && value.type === "Iterator" && IsOptionalString(value.$id) && IsSchema2(value.items);
}
function IsKindOf2(value, kind) {
  return IsObject(value) && Kind in value && value[Kind] === kind;
}
function IsLiteralString(value) {
  return IsLiteral2(value) && IsString(value.const);
}
function IsLiteralNumber(value) {
  return IsLiteral2(value) && IsNumber(value.const);
}
function IsLiteralBoolean(value) {
  return IsLiteral2(value) && IsBoolean(value.const);
}
function IsLiteral2(value) {
  return IsKindOf2(value, "Literal") && IsOptionalString(value.$id) && IsLiteralValue2(value.const);
}
function IsLiteralValue2(value) {
  return IsBoolean(value) || IsNumber(value) || IsString(value);
}
function IsMappedKey2(value) {
  return IsKindOf2(value, "MappedKey") && IsArray(value.keys) && value.keys.every((key) => IsNumber(key) || IsString(key));
}
function IsMappedResult2(value) {
  return IsKindOf2(value, "MappedResult") && IsProperties(value.properties);
}
function IsNever2(value) {
  return IsKindOf2(value, "Never") && IsObject(value.not) && Object.getOwnPropertyNames(value.not).length === 0;
}
function IsNot2(value) {
  return IsKindOf2(value, "Not") && IsSchema2(value.not);
}
function IsNull3(value) {
  return IsKindOf2(value, "Null") && value.type === "null" && IsOptionalString(value.$id);
}
function IsNumber4(value) {
  return IsKindOf2(value, "Number") && value.type === "number" && IsOptionalString(value.$id) && IsOptionalNumber(value.exclusiveMaximum) && IsOptionalNumber(value.exclusiveMinimum) && IsOptionalNumber(value.maximum) && IsOptionalNumber(value.minimum) && IsOptionalNumber(value.multipleOf);
}
function IsObject4(value) {
  return IsKindOf2(value, "Object") && value.type === "object" && IsOptionalString(value.$id) && IsProperties(value.properties) && IsAdditionalProperties(value.additionalProperties) && IsOptionalNumber(value.minProperties) && IsOptionalNumber(value.maxProperties);
}
function IsPromise2(value) {
  return IsKindOf2(value, "Promise") && value.type === "Promise" && IsOptionalString(value.$id) && IsSchema2(value.item);
}
function IsRecord2(value) {
  return IsKindOf2(value, "Record") && value.type === "object" && IsOptionalString(value.$id) && IsAdditionalProperties(value.additionalProperties) && IsObject(value.patternProperties) && ((schema) => {
    const keys = Object.getOwnPropertyNames(schema.patternProperties);
    return keys.length === 1 && IsPattern(keys[0]) && IsObject(schema.patternProperties) && IsSchema2(schema.patternProperties[keys[0]]);
  })(value);
}
function IsRecursive(value) {
  return IsObject(value) && Hint in value && value[Hint] === "Recursive";
}
function IsRef2(value) {
  return IsKindOf2(value, "Ref") && IsOptionalString(value.$id) && IsString(value.$ref);
}
function IsRegExp3(value) {
  return IsKindOf2(value, "RegExp") && IsOptionalString(value.$id) && IsString(value.source) && IsString(value.flags) && IsOptionalNumber(value.maxLength) && IsOptionalNumber(value.minLength);
}
function IsString3(value) {
  return IsKindOf2(value, "String") && value.type === "string" && IsOptionalString(value.$id) && IsOptionalNumber(value.minLength) && IsOptionalNumber(value.maxLength) && IsOptionalPattern(value.pattern) && IsOptionalFormat(value.format);
}
function IsSymbol3(value) {
  return IsKindOf2(value, "Symbol") && value.type === "symbol" && IsOptionalString(value.$id);
}
function IsTemplateLiteral2(value) {
  return IsKindOf2(value, "TemplateLiteral") && value.type === "string" && IsString(value.pattern) && value.pattern[0] === "^" && value.pattern[value.pattern.length - 1] === "$";
}
function IsThis2(value) {
  return IsKindOf2(value, "This") && IsOptionalString(value.$id) && IsString(value.$ref);
}
function IsTransform2(value) {
  return IsObject(value) && TransformKind in value;
}
function IsTuple2(value) {
  return IsKindOf2(value, "Tuple") && value.type === "array" && IsOptionalString(value.$id) && IsNumber(value.minItems) && IsNumber(value.maxItems) && value.minItems === value.maxItems && // empty
  (IsUndefined(value.items) && IsUndefined(value.additionalItems) && value.minItems === 0 || IsArray(value.items) && value.items.every((schema) => IsSchema2(schema)));
}
function IsUndefined4(value) {
  return IsKindOf2(value, "Undefined") && value.type === "undefined" && IsOptionalString(value.$id);
}
function IsUnionLiteral(value) {
  return IsUnion2(value) && value.anyOf.every((schema) => IsLiteralString(schema) || IsLiteralNumber(schema));
}
function IsUnion2(value) {
  return IsKindOf2(value, "Union") && IsOptionalString(value.$id) && IsObject(value) && IsArray(value.anyOf) && value.anyOf.every((schema) => IsSchema2(schema));
}
function IsUint8Array3(value) {
  return IsKindOf2(value, "Uint8Array") && value.type === "Uint8Array" && IsOptionalString(value.$id) && IsOptionalNumber(value.minByteLength) && IsOptionalNumber(value.maxByteLength);
}
function IsUnknown2(value) {
  return IsKindOf2(value, "Unknown") && IsOptionalString(value.$id);
}
function IsUnsafe2(value) {
  return IsKindOf2(value, "Unsafe");
}
function IsVoid2(value) {
  return IsKindOf2(value, "Void") && value.type === "void" && IsOptionalString(value.$id);
}
function IsKind2(value) {
  return IsObject(value) && Kind in value && IsString(value[Kind]) && !KnownTypes.includes(value[Kind]);
}
function IsSchema2(value) {
  return IsObject(value) && (IsAny2(value) || IsArgument2(value) || IsArray4(value) || IsBoolean3(value) || IsBigInt3(value) || IsAsyncIterator3(value) || IsComputed2(value) || IsConstructor2(value) || IsDate3(value) || IsFunction3(value) || IsInteger2(value) || IsIntersect2(value) || IsIterator3(value) || IsLiteral2(value) || IsMappedKey2(value) || IsMappedResult2(value) || IsNever2(value) || IsNot2(value) || IsNull3(value) || IsNumber4(value) || IsObject4(value) || IsPromise2(value) || IsRecord2(value) || IsRef2(value) || IsRegExp3(value) || IsString3(value) || IsSymbol3(value) || IsTemplateLiteral2(value) || IsThis2(value) || IsTuple2(value) || IsUndefined4(value) || IsUnion2(value) || IsUint8Array3(value) || IsUnknown2(value) || IsUnsafe2(value) || IsVoid2(value) || IsKind2(value));
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/patterns/patterns.mjs
var PatternBoolean = "(true|false)";
var PatternNumber = "(0|[1-9][0-9]*)";
var PatternString = "(.*)";
var PatternNever = "(?!.*)";
var PatternBooleanExact = `^${PatternBoolean}$`;
var PatternNumberExact = `^${PatternNumber}$`;
var PatternStringExact = `^${PatternString}$`;
var PatternNeverExact = `^${PatternNever}$`;

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/sets/set.mjs
function SetIncludes(T, S) {
  return T.includes(S);
}
function SetDistinct(T) {
  return [...new Set(T)];
}
function SetIntersect(T, S) {
  return T.filter((L) => S.includes(L));
}
function SetIntersectManyResolve(T, Init) {
  return T.reduce((Acc, L) => {
    return SetIntersect(Acc, L);
  }, Init);
}
function SetIntersectMany(T) {
  return T.length === 1 ? T[0] : T.length > 1 ? SetIntersectManyResolve(T.slice(1), T[0]) : [];
}
function SetUnionMany(T) {
  const Acc = [];
  for (const L of T)
    Acc.push(...L);
  return Acc;
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/any/any.mjs
function Any(options) {
  return CreateType({ [Kind]: "Any" }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/array/array.mjs
function Array2(items, options) {
  return CreateType({ [Kind]: "Array", type: "array", items }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/argument/argument.mjs
function Argument(index) {
  return CreateType({ [Kind]: "Argument", index });
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/async-iterator/async-iterator.mjs
function AsyncIterator(items, options) {
  return CreateType({ [Kind]: "AsyncIterator", type: "AsyncIterator", items }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/computed/computed.mjs
function Computed(target, parameters, options) {
  return CreateType({ [Kind]: "Computed", target, parameters }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/discard/discard.mjs
function DiscardKey(value, key) {
  const { [key]: _, ...rest } = value;
  return rest;
}
function Discard(value, keys) {
  return keys.reduce((acc, key) => DiscardKey(acc, key), value);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/never/never.mjs
function Never(options) {
  return CreateType({ [Kind]: "Never", not: {} }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/mapped/mapped-result.mjs
function MappedResult(properties) {
  return CreateType({
    [Kind]: "MappedResult",
    properties
  });
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/constructor/constructor.mjs
function Constructor(parameters, returns, options) {
  return CreateType({ [Kind]: "Constructor", type: "Constructor", parameters, returns }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/function/function.mjs
function Function2(parameters, returns, options) {
  return CreateType({ [Kind]: "Function", type: "Function", parameters, returns }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/union/union-create.mjs
function UnionCreate(T, options) {
  return CreateType({ [Kind]: "Union", anyOf: T }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/union/union-evaluated.mjs
function IsUnionOptional(types) {
  return types.some((type) => IsOptional(type));
}
function RemoveOptionalFromRest(types) {
  return types.map((left) => IsOptional(left) ? RemoveOptionalFromType(left) : left);
}
function RemoveOptionalFromType(T) {
  return Discard(T, [OptionalKind]);
}
function ResolveUnion(types, options) {
  const isOptional = IsUnionOptional(types);
  return isOptional ? Optional(UnionCreate(RemoveOptionalFromRest(types), options)) : UnionCreate(RemoveOptionalFromRest(types), options);
}
function UnionEvaluated(T, options) {
  return T.length === 1 ? CreateType(T[0], options) : T.length === 0 ? Never(options) : ResolveUnion(T, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/union/union.mjs
function Union(types, options) {
  return types.length === 0 ? Never(options) : types.length === 1 ? CreateType(types[0], options) : UnionCreate(types, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/template-literal/parse.mjs
var TemplateLiteralParserError = class extends TypeBoxError {
};
function Unescape(pattern) {
  return pattern.replace(/\\\$/g, "$").replace(/\\\*/g, "*").replace(/\\\^/g, "^").replace(/\\\|/g, "|").replace(/\\\(/g, "(").replace(/\\\)/g, ")");
}
function IsNonEscaped(pattern, index, char) {
  return pattern[index] === char && pattern.charCodeAt(index - 1) !== 92;
}
function IsOpenParen(pattern, index) {
  return IsNonEscaped(pattern, index, "(");
}
function IsCloseParen(pattern, index) {
  return IsNonEscaped(pattern, index, ")");
}
function IsSeparator(pattern, index) {
  return IsNonEscaped(pattern, index, "|");
}
function IsGroup(pattern) {
  if (!(IsOpenParen(pattern, 0) && IsCloseParen(pattern, pattern.length - 1)))
    return false;
  let count = 0;
  for (let index = 0; index < pattern.length; index++) {
    if (IsOpenParen(pattern, index))
      count += 1;
    if (IsCloseParen(pattern, index))
      count -= 1;
    if (count === 0 && index !== pattern.length - 1)
      return false;
  }
  return true;
}
function InGroup(pattern) {
  return pattern.slice(1, pattern.length - 1);
}
function IsPrecedenceOr(pattern) {
  let count = 0;
  for (let index = 0; index < pattern.length; index++) {
    if (IsOpenParen(pattern, index))
      count += 1;
    if (IsCloseParen(pattern, index))
      count -= 1;
    if (IsSeparator(pattern, index) && count === 0)
      return true;
  }
  return false;
}
function IsPrecedenceAnd(pattern) {
  for (let index = 0; index < pattern.length; index++) {
    if (IsOpenParen(pattern, index))
      return true;
  }
  return false;
}
function Or(pattern) {
  let [count, start] = [0, 0];
  const expressions = [];
  for (let index = 0; index < pattern.length; index++) {
    if (IsOpenParen(pattern, index))
      count += 1;
    if (IsCloseParen(pattern, index))
      count -= 1;
    if (IsSeparator(pattern, index) && count === 0) {
      const range2 = pattern.slice(start, index);
      if (range2.length > 0)
        expressions.push(TemplateLiteralParse(range2));
      start = index + 1;
    }
  }
  const range = pattern.slice(start);
  if (range.length > 0)
    expressions.push(TemplateLiteralParse(range));
  if (expressions.length === 0)
    return { type: "const", const: "" };
  if (expressions.length === 1)
    return expressions[0];
  return { type: "or", expr: expressions };
}
function And(pattern) {
  function Group(value, index) {
    if (!IsOpenParen(value, index))
      throw new TemplateLiteralParserError(`TemplateLiteralParser: Index must point to open parens`);
    let count = 0;
    for (let scan = index; scan < value.length; scan++) {
      if (IsOpenParen(value, scan))
        count += 1;
      if (IsCloseParen(value, scan))
        count -= 1;
      if (count === 0)
        return [index, scan];
    }
    throw new TemplateLiteralParserError(`TemplateLiteralParser: Unclosed group parens in expression`);
  }
  function Range(pattern2, index) {
    for (let scan = index; scan < pattern2.length; scan++) {
      if (IsOpenParen(pattern2, scan))
        return [index, scan];
    }
    return [index, pattern2.length];
  }
  const expressions = [];
  for (let index = 0; index < pattern.length; index++) {
    if (IsOpenParen(pattern, index)) {
      const [start, end] = Group(pattern, index);
      const range = pattern.slice(start, end + 1);
      expressions.push(TemplateLiteralParse(range));
      index = end;
    } else {
      const [start, end] = Range(pattern, index);
      const range = pattern.slice(start, end);
      if (range.length > 0)
        expressions.push(TemplateLiteralParse(range));
      index = end - 1;
    }
  }
  return expressions.length === 0 ? { type: "const", const: "" } : expressions.length === 1 ? expressions[0] : { type: "and", expr: expressions };
}
function TemplateLiteralParse(pattern) {
  return IsGroup(pattern) ? TemplateLiteralParse(InGroup(pattern)) : IsPrecedenceOr(pattern) ? Or(pattern) : IsPrecedenceAnd(pattern) ? And(pattern) : { type: "const", const: Unescape(pattern) };
}
function TemplateLiteralParseExact(pattern) {
  return TemplateLiteralParse(pattern.slice(1, pattern.length - 1));
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/template-literal/finite.mjs
var TemplateLiteralFiniteError = class extends TypeBoxError {
};
function IsNumberExpression(expression) {
  return expression.type === "or" && expression.expr.length === 2 && expression.expr[0].type === "const" && expression.expr[0].const === "0" && expression.expr[1].type === "const" && expression.expr[1].const === "[1-9][0-9]*";
}
function IsBooleanExpression(expression) {
  return expression.type === "or" && expression.expr.length === 2 && expression.expr[0].type === "const" && expression.expr[0].const === "true" && expression.expr[1].type === "const" && expression.expr[1].const === "false";
}
function IsStringExpression(expression) {
  return expression.type === "const" && expression.const === ".*";
}
function IsTemplateLiteralExpressionFinite(expression) {
  return IsNumberExpression(expression) || IsStringExpression(expression) ? false : IsBooleanExpression(expression) ? true : expression.type === "and" ? expression.expr.every((expr) => IsTemplateLiteralExpressionFinite(expr)) : expression.type === "or" ? expression.expr.every((expr) => IsTemplateLiteralExpressionFinite(expr)) : expression.type === "const" ? true : (() => {
    throw new TemplateLiteralFiniteError(`Unknown expression type`);
  })();
}
function IsTemplateLiteralFinite(schema) {
  const expression = TemplateLiteralParseExact(schema.pattern);
  return IsTemplateLiteralExpressionFinite(expression);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/template-literal/generate.mjs
var TemplateLiteralGenerateError = class extends TypeBoxError {
};
function* GenerateReduce(buffer) {
  if (buffer.length === 1)
    return yield* buffer[0];
  for (const left of buffer[0]) {
    for (const right of GenerateReduce(buffer.slice(1))) {
      yield `${left}${right}`;
    }
  }
}
function* GenerateAnd(expression) {
  return yield* GenerateReduce(expression.expr.map((expr) => [...TemplateLiteralExpressionGenerate(expr)]));
}
function* GenerateOr(expression) {
  for (const expr of expression.expr)
    yield* TemplateLiteralExpressionGenerate(expr);
}
function* GenerateConst(expression) {
  return yield expression.const;
}
function* TemplateLiteralExpressionGenerate(expression) {
  return expression.type === "and" ? yield* GenerateAnd(expression) : expression.type === "or" ? yield* GenerateOr(expression) : expression.type === "const" ? yield* GenerateConst(expression) : (() => {
    throw new TemplateLiteralGenerateError("Unknown expression");
  })();
}
function TemplateLiteralGenerate(schema) {
  const expression = TemplateLiteralParseExact(schema.pattern);
  return IsTemplateLiteralExpressionFinite(expression) ? [...TemplateLiteralExpressionGenerate(expression)] : [];
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/literal/literal.mjs
function Literal(value, options) {
  return CreateType({
    [Kind]: "Literal",
    const: value,
    type: typeof value
  }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/boolean/boolean.mjs
function Boolean(options) {
  return CreateType({ [Kind]: "Boolean", type: "boolean" }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/bigint/bigint.mjs
function BigInt(options) {
  return CreateType({ [Kind]: "BigInt", type: "bigint" }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/number/number.mjs
function Number2(options) {
  return CreateType({ [Kind]: "Number", type: "number" }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/string/string.mjs
function String2(options) {
  return CreateType({ [Kind]: "String", type: "string" }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/template-literal/syntax.mjs
function* FromUnion(syntax) {
  const trim = syntax.trim().replace(/"|'/g, "");
  return trim === "boolean" ? yield Boolean() : trim === "number" ? yield Number2() : trim === "bigint" ? yield BigInt() : trim === "string" ? yield String2() : yield (() => {
    const literals = trim.split("|").map((literal) => Literal(literal.trim()));
    return literals.length === 0 ? Never() : literals.length === 1 ? literals[0] : UnionEvaluated(literals);
  })();
}
function* FromTerminal(syntax) {
  if (syntax[1] !== "{") {
    const L = Literal("$");
    const R = FromSyntax(syntax.slice(1));
    return yield* [L, ...R];
  }
  for (let i = 2; i < syntax.length; i++) {
    if (syntax[i] === "}") {
      const L = FromUnion(syntax.slice(2, i));
      const R = FromSyntax(syntax.slice(i + 1));
      return yield* [...L, ...R];
    }
  }
  yield Literal(syntax);
}
function* FromSyntax(syntax) {
  for (let i = 0; i < syntax.length; i++) {
    if (syntax[i] === "$") {
      const L = Literal(syntax.slice(0, i));
      const R = FromTerminal(syntax.slice(i));
      return yield* [L, ...R];
    }
  }
  yield Literal(syntax);
}
function TemplateLiteralSyntax(syntax) {
  return [...FromSyntax(syntax)];
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/template-literal/pattern.mjs
var TemplateLiteralPatternError = class extends TypeBoxError {
};
function Escape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function Visit2(schema, acc) {
  return IsTemplateLiteral(schema) ? schema.pattern.slice(1, schema.pattern.length - 1) : IsUnion(schema) ? `(${schema.anyOf.map((schema2) => Visit2(schema2, acc)).join("|")})` : IsNumber3(schema) ? `${acc}${PatternNumber}` : IsInteger(schema) ? `${acc}${PatternNumber}` : IsBigInt2(schema) ? `${acc}${PatternNumber}` : IsString2(schema) ? `${acc}${PatternString}` : IsLiteral(schema) ? `${acc}${Escape(schema.const.toString())}` : IsBoolean2(schema) ? `${acc}${PatternBoolean}` : (() => {
    throw new TemplateLiteralPatternError(`Unexpected Kind '${schema[Kind]}'`);
  })();
}
function TemplateLiteralPattern(kinds) {
  return `^${kinds.map((schema) => Visit2(schema, "")).join("")}$`;
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/template-literal/union.mjs
function TemplateLiteralToUnion(schema) {
  const R = TemplateLiteralGenerate(schema);
  const L = R.map((S) => Literal(S));
  return UnionEvaluated(L);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/template-literal/template-literal.mjs
function TemplateLiteral(unresolved, options) {
  const pattern = IsString(unresolved) ? TemplateLiteralPattern(TemplateLiteralSyntax(unresolved)) : TemplateLiteralPattern(unresolved);
  return CreateType({ [Kind]: "TemplateLiteral", type: "string", pattern }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/indexed/indexed-property-keys.mjs
function FromTemplateLiteral(templateLiteral) {
  const keys = TemplateLiteralGenerate(templateLiteral);
  return keys.map((key) => key.toString());
}
function FromUnion2(types) {
  const result2 = [];
  for (const type of types)
    result2.push(...IndexPropertyKeys(type));
  return result2;
}
function FromLiteral(literalValue) {
  return [literalValue.toString()];
}
function IndexPropertyKeys(type) {
  return [...new Set(IsTemplateLiteral(type) ? FromTemplateLiteral(type) : IsUnion(type) ? FromUnion2(type.anyOf) : IsLiteral(type) ? FromLiteral(type.const) : IsNumber3(type) ? ["[number]"] : IsInteger(type) ? ["[number]"] : [])];
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/indexed/indexed-from-mapped-result.mjs
function FromProperties(type, properties, options) {
  const result2 = {};
  for (const K2 of Object.getOwnPropertyNames(properties)) {
    result2[K2] = Index(type, IndexPropertyKeys(properties[K2]), options);
  }
  return result2;
}
function FromMappedResult(type, mappedResult, options) {
  return FromProperties(type, mappedResult.properties, options);
}
function IndexFromMappedResult(type, mappedResult, options) {
  const properties = FromMappedResult(type, mappedResult, options);
  return MappedResult(properties);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/indexed/indexed.mjs
function FromRest(types, key) {
  return types.map((type) => IndexFromPropertyKey(type, key));
}
function FromIntersectRest(types) {
  return types.filter((type) => !IsNever(type));
}
function FromIntersect(types, key) {
  return IntersectEvaluated(FromIntersectRest(FromRest(types, key)));
}
function FromUnionRest(types) {
  return types.some((L) => IsNever(L)) ? [] : types;
}
function FromUnion3(types, key) {
  return UnionEvaluated(FromUnionRest(FromRest(types, key)));
}
function FromTuple(types, key) {
  return key in types ? types[key] : key === "[number]" ? UnionEvaluated(types) : Never();
}
function FromArray(type, key) {
  return key === "[number]" ? type : Never();
}
function FromProperty(properties, propertyKey) {
  return propertyKey in properties ? properties[propertyKey] : Never();
}
function IndexFromPropertyKey(type, propertyKey) {
  return IsIntersect(type) ? FromIntersect(type.allOf, propertyKey) : IsUnion(type) ? FromUnion3(type.anyOf, propertyKey) : IsTuple(type) ? FromTuple(type.items ?? [], propertyKey) : IsArray3(type) ? FromArray(type.items, propertyKey) : IsObject3(type) ? FromProperty(type.properties, propertyKey) : Never();
}
function IndexFromPropertyKeys(type, propertyKeys) {
  return propertyKeys.map((propertyKey) => IndexFromPropertyKey(type, propertyKey));
}
function FromSchema(type, propertyKeys) {
  return UnionEvaluated(IndexFromPropertyKeys(type, propertyKeys));
}
function Index(type, key, options) {
  if (IsRef(type) || IsRef(key)) {
    const error = `Index types using Ref parameters require both Type and Key to be of TSchema`;
    if (!IsSchema(type) || !IsSchema(key))
      throw new TypeBoxError(error);
    return Computed("Index", [type, key]);
  }
  if (IsMappedResult(key))
    return IndexFromMappedResult(type, key, options);
  if (IsMappedKey(key))
    return IndexFromMappedKey(type, key, options);
  return CreateType(IsSchema(key) ? FromSchema(type, IndexPropertyKeys(key)) : FromSchema(type, key), options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/indexed/indexed-from-mapped-key.mjs
function MappedIndexPropertyKey(type, key, options) {
  return { [key]: Index(type, [key], Clone(options)) };
}
function MappedIndexPropertyKeys(type, propertyKeys, options) {
  return propertyKeys.reduce((result2, left) => {
    return { ...result2, ...MappedIndexPropertyKey(type, left, options) };
  }, {});
}
function MappedIndexProperties(type, mappedKey, options) {
  return MappedIndexPropertyKeys(type, mappedKey.keys, options);
}
function IndexFromMappedKey(type, mappedKey, options) {
  const properties = MappedIndexProperties(type, mappedKey, options);
  return MappedResult(properties);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/iterator/iterator.mjs
function Iterator(items, options) {
  return CreateType({ [Kind]: "Iterator", type: "Iterator", items }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/object/object.mjs
function RequiredArray(properties) {
  return globalThis.Object.keys(properties).filter((key) => !IsOptional(properties[key]));
}
function _Object_(properties, options) {
  const required2 = RequiredArray(properties);
  const schema = required2.length > 0 ? { [Kind]: "Object", type: "object", required: required2, properties } : { [Kind]: "Object", type: "object", properties };
  return CreateType(schema, options);
}
var Object2 = _Object_;

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/promise/promise.mjs
function Promise2(item, options) {
  return CreateType({ [Kind]: "Promise", type: "Promise", item }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/readonly/readonly.mjs
function RemoveReadonly(schema) {
  return CreateType(Discard(schema, [ReadonlyKind]));
}
function AddReadonly(schema) {
  return CreateType({ ...schema, [ReadonlyKind]: "Readonly" });
}
function ReadonlyWithFlag(schema, F) {
  return F === false ? RemoveReadonly(schema) : AddReadonly(schema);
}
function Readonly(schema, enable) {
  const F = enable ?? true;
  return IsMappedResult(schema) ? ReadonlyFromMappedResult(schema, F) : ReadonlyWithFlag(schema, F);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/readonly/readonly-from-mapped-result.mjs
function FromProperties2(K, F) {
  const Acc = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(K))
    Acc[K2] = Readonly(K[K2], F);
  return Acc;
}
function FromMappedResult2(R, F) {
  return FromProperties2(R.properties, F);
}
function ReadonlyFromMappedResult(R, F) {
  const P = FromMappedResult2(R, F);
  return MappedResult(P);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/tuple/tuple.mjs
function Tuple(types, options) {
  return CreateType(types.length > 0 ? { [Kind]: "Tuple", type: "array", items: types, additionalItems: false, minItems: types.length, maxItems: types.length } : { [Kind]: "Tuple", type: "array", minItems: types.length, maxItems: types.length }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/mapped/mapped.mjs
function FromMappedResult3(K, P) {
  return K in P ? FromSchemaType(K, P[K]) : MappedResult(P);
}
function MappedKeyToKnownMappedResultProperties(K) {
  return { [K]: Literal(K) };
}
function MappedKeyToUnknownMappedResultProperties(P) {
  const Acc = {};
  for (const L of P)
    Acc[L] = Literal(L);
  return Acc;
}
function MappedKeyToMappedResultProperties(K, P) {
  return SetIncludes(P, K) ? MappedKeyToKnownMappedResultProperties(K) : MappedKeyToUnknownMappedResultProperties(P);
}
function FromMappedKey(K, P) {
  const R = MappedKeyToMappedResultProperties(K, P);
  return FromMappedResult3(K, R);
}
function FromRest2(K, T) {
  return T.map((L) => FromSchemaType(K, L));
}
function FromProperties3(K, T) {
  const Acc = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(T))
    Acc[K2] = FromSchemaType(K, T[K2]);
  return Acc;
}
function FromSchemaType(K, T) {
  const options = { ...T };
  return (
    // unevaluated modifier types
    IsOptional(T) ? Optional(FromSchemaType(K, Discard(T, [OptionalKind]))) : IsReadonly(T) ? Readonly(FromSchemaType(K, Discard(T, [ReadonlyKind]))) : (
      // unevaluated mapped types
      IsMappedResult(T) ? FromMappedResult3(K, T.properties) : IsMappedKey(T) ? FromMappedKey(K, T.keys) : (
        // unevaluated types
        IsConstructor(T) ? Constructor(FromRest2(K, T.parameters), FromSchemaType(K, T.returns), options) : IsFunction2(T) ? Function2(FromRest2(K, T.parameters), FromSchemaType(K, T.returns), options) : IsAsyncIterator2(T) ? AsyncIterator(FromSchemaType(K, T.items), options) : IsIterator2(T) ? Iterator(FromSchemaType(K, T.items), options) : IsIntersect(T) ? Intersect(FromRest2(K, T.allOf), options) : IsUnion(T) ? Union(FromRest2(K, T.anyOf), options) : IsTuple(T) ? Tuple(FromRest2(K, T.items ?? []), options) : IsObject3(T) ? Object2(FromProperties3(K, T.properties), options) : IsArray3(T) ? Array2(FromSchemaType(K, T.items), options) : IsPromise(T) ? Promise2(FromSchemaType(K, T.item), options) : T
      )
    )
  );
}
function MappedFunctionReturnType(K, T) {
  const Acc = {};
  for (const L of K)
    Acc[L] = FromSchemaType(L, T);
  return Acc;
}
function Mapped(key, map, options) {
  const K = IsSchema(key) ? IndexPropertyKeys(key) : key;
  const RT = map({ [Kind]: "MappedKey", keys: K });
  const R = MappedFunctionReturnType(K, RT);
  return Object2(R, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/optional/optional.mjs
function RemoveOptional(schema) {
  return CreateType(Discard(schema, [OptionalKind]));
}
function AddOptional(schema) {
  return CreateType({ ...schema, [OptionalKind]: "Optional" });
}
function OptionalWithFlag(schema, F) {
  return F === false ? RemoveOptional(schema) : AddOptional(schema);
}
function Optional(schema, enable) {
  const F = enable ?? true;
  return IsMappedResult(schema) ? OptionalFromMappedResult(schema, F) : OptionalWithFlag(schema, F);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/optional/optional-from-mapped-result.mjs
function FromProperties4(P, F) {
  const Acc = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(P))
    Acc[K2] = Optional(P[K2], F);
  return Acc;
}
function FromMappedResult4(R, F) {
  return FromProperties4(R.properties, F);
}
function OptionalFromMappedResult(R, F) {
  const P = FromMappedResult4(R, F);
  return MappedResult(P);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/intersect/intersect-create.mjs
function IntersectCreate(T, options = {}) {
  const allObjects = T.every((schema) => IsObject3(schema));
  const clonedUnevaluatedProperties = IsSchema(options.unevaluatedProperties) ? { unevaluatedProperties: options.unevaluatedProperties } : {};
  return CreateType(options.unevaluatedProperties === false || IsSchema(options.unevaluatedProperties) || allObjects ? { ...clonedUnevaluatedProperties, [Kind]: "Intersect", type: "object", allOf: T } : { ...clonedUnevaluatedProperties, [Kind]: "Intersect", allOf: T }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/intersect/intersect-evaluated.mjs
function IsIntersectOptional(types) {
  return types.every((left) => IsOptional(left));
}
function RemoveOptionalFromType2(type) {
  return Discard(type, [OptionalKind]);
}
function RemoveOptionalFromRest2(types) {
  return types.map((left) => IsOptional(left) ? RemoveOptionalFromType2(left) : left);
}
function ResolveIntersect(types, options) {
  return IsIntersectOptional(types) ? Optional(IntersectCreate(RemoveOptionalFromRest2(types), options)) : IntersectCreate(RemoveOptionalFromRest2(types), options);
}
function IntersectEvaluated(types, options = {}) {
  if (types.length === 1)
    return CreateType(types[0], options);
  if (types.length === 0)
    return Never(options);
  if (types.some((schema) => IsTransform(schema)))
    throw new Error("Cannot intersect transform types");
  return ResolveIntersect(types, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/intersect/intersect.mjs
function Intersect(types, options) {
  if (types.length === 1)
    return CreateType(types[0], options);
  if (types.length === 0)
    return Never(options);
  if (types.some((schema) => IsTransform(schema)))
    throw new Error("Cannot intersect transform types");
  return IntersectCreate(types, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/ref/ref.mjs
function Ref(...args) {
  const [$ref, options] = typeof args[0] === "string" ? [args[0], args[1]] : [args[0].$id, args[1]];
  if (typeof $ref !== "string")
    throw new TypeBoxError("Ref: $ref must be a string");
  return CreateType({ [Kind]: "Ref", $ref }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/awaited/awaited.mjs
function FromComputed(target, parameters) {
  return Computed("Awaited", [Computed(target, parameters)]);
}
function FromRef($ref) {
  return Computed("Awaited", [Ref($ref)]);
}
function FromIntersect2(types) {
  return Intersect(FromRest3(types));
}
function FromUnion4(types) {
  return Union(FromRest3(types));
}
function FromPromise(type) {
  return Awaited(type);
}
function FromRest3(types) {
  return types.map((type) => Awaited(type));
}
function Awaited(type, options) {
  return CreateType(IsComputed(type) ? FromComputed(type.target, type.parameters) : IsIntersect(type) ? FromIntersect2(type.allOf) : IsUnion(type) ? FromUnion4(type.anyOf) : IsPromise(type) ? FromPromise(type.item) : IsRef(type) ? FromRef(type.$ref) : type, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/keyof/keyof-property-keys.mjs
function FromRest4(types) {
  const result2 = [];
  for (const L of types)
    result2.push(KeyOfPropertyKeys(L));
  return result2;
}
function FromIntersect3(types) {
  const propertyKeysArray = FromRest4(types);
  const propertyKeys = SetUnionMany(propertyKeysArray);
  return propertyKeys;
}
function FromUnion5(types) {
  const propertyKeysArray = FromRest4(types);
  const propertyKeys = SetIntersectMany(propertyKeysArray);
  return propertyKeys;
}
function FromTuple2(types) {
  return types.map((_, indexer) => indexer.toString());
}
function FromArray2(_) {
  return ["[number]"];
}
function FromProperties5(T) {
  return globalThis.Object.getOwnPropertyNames(T);
}
function FromPatternProperties(patternProperties) {
  if (!includePatternProperties)
    return [];
  const patternPropertyKeys = globalThis.Object.getOwnPropertyNames(patternProperties);
  return patternPropertyKeys.map((key) => {
    return key[0] === "^" && key[key.length - 1] === "$" ? key.slice(1, key.length - 1) : key;
  });
}
function KeyOfPropertyKeys(type) {
  return IsIntersect(type) ? FromIntersect3(type.allOf) : IsUnion(type) ? FromUnion5(type.anyOf) : IsTuple(type) ? FromTuple2(type.items ?? []) : IsArray3(type) ? FromArray2(type.items) : IsObject3(type) ? FromProperties5(type.properties) : IsRecord(type) ? FromPatternProperties(type.patternProperties) : [];
}
var includePatternProperties = false;

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/keyof/keyof.mjs
function FromComputed2(target, parameters) {
  return Computed("KeyOf", [Computed(target, parameters)]);
}
function FromRef2($ref) {
  return Computed("KeyOf", [Ref($ref)]);
}
function KeyOfFromType(type, options) {
  const propertyKeys = KeyOfPropertyKeys(type);
  const propertyKeyTypes = KeyOfPropertyKeysToRest(propertyKeys);
  const result2 = UnionEvaluated(propertyKeyTypes);
  return CreateType(result2, options);
}
function KeyOfPropertyKeysToRest(propertyKeys) {
  return propertyKeys.map((L) => L === "[number]" ? Number2() : Literal(L));
}
function KeyOf(type, options) {
  return IsComputed(type) ? FromComputed2(type.target, type.parameters) : IsRef(type) ? FromRef2(type.$ref) : IsMappedResult(type) ? KeyOfFromMappedResult(type, options) : KeyOfFromType(type, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/keyof/keyof-from-mapped-result.mjs
function FromProperties6(properties, options) {
  const result2 = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(properties))
    result2[K2] = KeyOf(properties[K2], Clone(options));
  return result2;
}
function FromMappedResult5(mappedResult, options) {
  return FromProperties6(mappedResult.properties, options);
}
function KeyOfFromMappedResult(mappedResult, options) {
  const properties = FromMappedResult5(mappedResult, options);
  return MappedResult(properties);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/composite/composite.mjs
function CompositeKeys(T) {
  const Acc = [];
  for (const L of T)
    Acc.push(...KeyOfPropertyKeys(L));
  return SetDistinct(Acc);
}
function FilterNever(T) {
  return T.filter((L) => !IsNever(L));
}
function CompositeProperty(T, K) {
  const Acc = [];
  for (const L of T)
    Acc.push(...IndexFromPropertyKeys(L, [K]));
  return FilterNever(Acc);
}
function CompositeProperties(T, K) {
  const Acc = {};
  for (const L of K) {
    Acc[L] = IntersectEvaluated(CompositeProperty(T, L));
  }
  return Acc;
}
function Composite(T, options) {
  const K = CompositeKeys(T);
  const P = CompositeProperties(T, K);
  const R = Object2(P, options);
  return R;
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/date/date.mjs
function Date2(options) {
  return CreateType({ [Kind]: "Date", type: "Date" }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/null/null.mjs
function Null(options) {
  return CreateType({ [Kind]: "Null", type: "null" }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/symbol/symbol.mjs
function Symbol2(options) {
  return CreateType({ [Kind]: "Symbol", type: "symbol" }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/undefined/undefined.mjs
function Undefined(options) {
  return CreateType({ [Kind]: "Undefined", type: "undefined" }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/uint8array/uint8array.mjs
function Uint8Array2(options) {
  return CreateType({ [Kind]: "Uint8Array", type: "Uint8Array" }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/unknown/unknown.mjs
function Unknown(options) {
  return CreateType({ [Kind]: "Unknown" }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/const/const.mjs
function FromArray3(T) {
  return T.map((L) => FromValue(L, false));
}
function FromProperties7(value) {
  const Acc = {};
  for (const K of globalThis.Object.getOwnPropertyNames(value))
    Acc[K] = Readonly(FromValue(value[K], false));
  return Acc;
}
function ConditionalReadonly(T, root) {
  return root === true ? T : Readonly(T);
}
function FromValue(value, root) {
  return IsAsyncIterator(value) ? ConditionalReadonly(Any(), root) : IsIterator(value) ? ConditionalReadonly(Any(), root) : IsArray(value) ? Readonly(Tuple(FromArray3(value))) : IsUint8Array(value) ? Uint8Array2() : IsDate(value) ? Date2() : IsObject(value) ? ConditionalReadonly(Object2(FromProperties7(value)), root) : IsFunction(value) ? ConditionalReadonly(Function2([], Unknown()), root) : IsUndefined(value) ? Undefined() : IsNull(value) ? Null() : IsSymbol(value) ? Symbol2() : IsBigInt(value) ? BigInt() : IsNumber(value) ? Literal(value) : IsBoolean(value) ? Literal(value) : IsString(value) ? Literal(value) : Object2({});
}
function Const(T, options) {
  return CreateType(FromValue(T, true), options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/constructor-parameters/constructor-parameters.mjs
function ConstructorParameters(schema, options) {
  return IsConstructor(schema) ? Tuple(schema.parameters, options) : Never(options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/enum/enum.mjs
function Enum(item, options) {
  if (IsUndefined(item))
    throw new Error("Enum undefined or empty");
  const values1 = globalThis.Object.getOwnPropertyNames(item).filter((key) => isNaN(key)).map((key) => item[key]);
  const values2 = [...new Set(values1)];
  const anyOf = values2.map((value) => Literal(value));
  return Union(anyOf, { ...options, [Hint]: "Enum" });
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/extends/extends-check.mjs
var ExtendsResolverError = class extends TypeBoxError {
};
var ExtendsResult;
(function(ExtendsResult2) {
  ExtendsResult2[ExtendsResult2["Union"] = 0] = "Union";
  ExtendsResult2[ExtendsResult2["True"] = 1] = "True";
  ExtendsResult2[ExtendsResult2["False"] = 2] = "False";
})(ExtendsResult || (ExtendsResult = {}));
function IntoBooleanResult(result2) {
  return result2 === ExtendsResult.False ? result2 : ExtendsResult.True;
}
function Throw(message) {
  throw new ExtendsResolverError(message);
}
function IsStructuralRight(right) {
  return type_exports.IsNever(right) || type_exports.IsIntersect(right) || type_exports.IsUnion(right) || type_exports.IsUnknown(right) || type_exports.IsAny(right);
}
function StructuralRight(left, right) {
  return type_exports.IsNever(right) ? FromNeverRight(left, right) : type_exports.IsIntersect(right) ? FromIntersectRight(left, right) : type_exports.IsUnion(right) ? FromUnionRight(left, right) : type_exports.IsUnknown(right) ? FromUnknownRight(left, right) : type_exports.IsAny(right) ? FromAnyRight(left, right) : Throw("StructuralRight");
}
function FromAnyRight(left, right) {
  return ExtendsResult.True;
}
function FromAny(left, right) {
  return type_exports.IsIntersect(right) ? FromIntersectRight(left, right) : type_exports.IsUnion(right) && right.anyOf.some((schema) => type_exports.IsAny(schema) || type_exports.IsUnknown(schema)) ? ExtendsResult.True : type_exports.IsUnion(right) ? ExtendsResult.Union : type_exports.IsUnknown(right) ? ExtendsResult.True : type_exports.IsAny(right) ? ExtendsResult.True : ExtendsResult.Union;
}
function FromArrayRight(left, right) {
  return type_exports.IsUnknown(left) ? ExtendsResult.False : type_exports.IsAny(left) ? ExtendsResult.Union : type_exports.IsNever(left) ? ExtendsResult.True : ExtendsResult.False;
}
function FromArray4(left, right) {
  return type_exports.IsObject(right) && IsObjectArrayLike(right) ? ExtendsResult.True : IsStructuralRight(right) ? StructuralRight(left, right) : !type_exports.IsArray(right) ? ExtendsResult.False : IntoBooleanResult(Visit3(left.items, right.items));
}
function FromAsyncIterator(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : !type_exports.IsAsyncIterator(right) ? ExtendsResult.False : IntoBooleanResult(Visit3(left.items, right.items));
}
function FromBigInt(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsRecord(right) ? FromRecordRight(left, right) : type_exports.IsBigInt(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromBooleanRight(left, right) {
  return type_exports.IsLiteralBoolean(left) ? ExtendsResult.True : type_exports.IsBoolean(left) ? ExtendsResult.True : ExtendsResult.False;
}
function FromBoolean(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsRecord(right) ? FromRecordRight(left, right) : type_exports.IsBoolean(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromConstructor(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : !type_exports.IsConstructor(right) ? ExtendsResult.False : left.parameters.length > right.parameters.length ? ExtendsResult.False : !left.parameters.every((schema, index) => IntoBooleanResult(Visit3(right.parameters[index], schema)) === ExtendsResult.True) ? ExtendsResult.False : IntoBooleanResult(Visit3(left.returns, right.returns));
}
function FromDate(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsRecord(right) ? FromRecordRight(left, right) : type_exports.IsDate(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromFunction(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : !type_exports.IsFunction(right) ? ExtendsResult.False : left.parameters.length > right.parameters.length ? ExtendsResult.False : !left.parameters.every((schema, index) => IntoBooleanResult(Visit3(right.parameters[index], schema)) === ExtendsResult.True) ? ExtendsResult.False : IntoBooleanResult(Visit3(left.returns, right.returns));
}
function FromIntegerRight(left, right) {
  return type_exports.IsLiteral(left) && value_exports.IsNumber(left.const) ? ExtendsResult.True : type_exports.IsNumber(left) || type_exports.IsInteger(left) ? ExtendsResult.True : ExtendsResult.False;
}
function FromInteger(left, right) {
  return type_exports.IsInteger(right) || type_exports.IsNumber(right) ? ExtendsResult.True : IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsRecord(right) ? FromRecordRight(left, right) : ExtendsResult.False;
}
function FromIntersectRight(left, right) {
  return right.allOf.every((schema) => Visit3(left, schema) === ExtendsResult.True) ? ExtendsResult.True : ExtendsResult.False;
}
function FromIntersect4(left, right) {
  return left.allOf.some((schema) => Visit3(schema, right) === ExtendsResult.True) ? ExtendsResult.True : ExtendsResult.False;
}
function FromIterator(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : !type_exports.IsIterator(right) ? ExtendsResult.False : IntoBooleanResult(Visit3(left.items, right.items));
}
function FromLiteral2(left, right) {
  return type_exports.IsLiteral(right) && right.const === left.const ? ExtendsResult.True : IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsRecord(right) ? FromRecordRight(left, right) : type_exports.IsString(right) ? FromStringRight(left, right) : type_exports.IsNumber(right) ? FromNumberRight(left, right) : type_exports.IsInteger(right) ? FromIntegerRight(left, right) : type_exports.IsBoolean(right) ? FromBooleanRight(left, right) : ExtendsResult.False;
}
function FromNeverRight(left, right) {
  return ExtendsResult.False;
}
function FromNever(left, right) {
  return ExtendsResult.True;
}
function UnwrapTNot(schema) {
  let [current, depth] = [schema, 0];
  while (true) {
    if (!type_exports.IsNot(current))
      break;
    current = current.not;
    depth += 1;
  }
  return depth % 2 === 0 ? current : Unknown();
}
function FromNot(left, right) {
  return type_exports.IsNot(left) ? Visit3(UnwrapTNot(left), right) : type_exports.IsNot(right) ? Visit3(left, UnwrapTNot(right)) : Throw("Invalid fallthrough for Not");
}
function FromNull(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsRecord(right) ? FromRecordRight(left, right) : type_exports.IsNull(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromNumberRight(left, right) {
  return type_exports.IsLiteralNumber(left) ? ExtendsResult.True : type_exports.IsNumber(left) || type_exports.IsInteger(left) ? ExtendsResult.True : ExtendsResult.False;
}
function FromNumber(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsRecord(right) ? FromRecordRight(left, right) : type_exports.IsInteger(right) || type_exports.IsNumber(right) ? ExtendsResult.True : ExtendsResult.False;
}
function IsObjectPropertyCount(schema, count) {
  return Object.getOwnPropertyNames(schema.properties).length === count;
}
function IsObjectStringLike(schema) {
  return IsObjectArrayLike(schema);
}
function IsObjectSymbolLike(schema) {
  return IsObjectPropertyCount(schema, 0) || IsObjectPropertyCount(schema, 1) && "description" in schema.properties && type_exports.IsUnion(schema.properties.description) && schema.properties.description.anyOf.length === 2 && (type_exports.IsString(schema.properties.description.anyOf[0]) && type_exports.IsUndefined(schema.properties.description.anyOf[1]) || type_exports.IsString(schema.properties.description.anyOf[1]) && type_exports.IsUndefined(schema.properties.description.anyOf[0]));
}
function IsObjectNumberLike(schema) {
  return IsObjectPropertyCount(schema, 0);
}
function IsObjectBooleanLike(schema) {
  return IsObjectPropertyCount(schema, 0);
}
function IsObjectBigIntLike(schema) {
  return IsObjectPropertyCount(schema, 0);
}
function IsObjectDateLike(schema) {
  return IsObjectPropertyCount(schema, 0);
}
function IsObjectUint8ArrayLike(schema) {
  return IsObjectArrayLike(schema);
}
function IsObjectFunctionLike(schema) {
  const length = Number2();
  return IsObjectPropertyCount(schema, 0) || IsObjectPropertyCount(schema, 1) && "length" in schema.properties && IntoBooleanResult(Visit3(schema.properties["length"], length)) === ExtendsResult.True;
}
function IsObjectConstructorLike(schema) {
  return IsObjectPropertyCount(schema, 0);
}
function IsObjectArrayLike(schema) {
  const length = Number2();
  return IsObjectPropertyCount(schema, 0) || IsObjectPropertyCount(schema, 1) && "length" in schema.properties && IntoBooleanResult(Visit3(schema.properties["length"], length)) === ExtendsResult.True;
}
function IsObjectPromiseLike(schema) {
  const then = Function2([Any()], Any());
  return IsObjectPropertyCount(schema, 0) || IsObjectPropertyCount(schema, 1) && "then" in schema.properties && IntoBooleanResult(Visit3(schema.properties["then"], then)) === ExtendsResult.True;
}
function Property(left, right) {
  return Visit3(left, right) === ExtendsResult.False ? ExtendsResult.False : type_exports.IsOptional(left) && !type_exports.IsOptional(right) ? ExtendsResult.False : ExtendsResult.True;
}
function FromObjectRight(left, right) {
  return type_exports.IsUnknown(left) ? ExtendsResult.False : type_exports.IsAny(left) ? ExtendsResult.Union : type_exports.IsNever(left) || type_exports.IsLiteralString(left) && IsObjectStringLike(right) || type_exports.IsLiteralNumber(left) && IsObjectNumberLike(right) || type_exports.IsLiteralBoolean(left) && IsObjectBooleanLike(right) || type_exports.IsSymbol(left) && IsObjectSymbolLike(right) || type_exports.IsBigInt(left) && IsObjectBigIntLike(right) || type_exports.IsString(left) && IsObjectStringLike(right) || type_exports.IsSymbol(left) && IsObjectSymbolLike(right) || type_exports.IsNumber(left) && IsObjectNumberLike(right) || type_exports.IsInteger(left) && IsObjectNumberLike(right) || type_exports.IsBoolean(left) && IsObjectBooleanLike(right) || type_exports.IsUint8Array(left) && IsObjectUint8ArrayLike(right) || type_exports.IsDate(left) && IsObjectDateLike(right) || type_exports.IsConstructor(left) && IsObjectConstructorLike(right) || type_exports.IsFunction(left) && IsObjectFunctionLike(right) ? ExtendsResult.True : type_exports.IsRecord(left) && type_exports.IsString(RecordKey(left)) ? (() => {
    return right[Hint] === "Record" ? ExtendsResult.True : ExtendsResult.False;
  })() : type_exports.IsRecord(left) && type_exports.IsNumber(RecordKey(left)) ? (() => {
    return IsObjectPropertyCount(right, 0) ? ExtendsResult.True : ExtendsResult.False;
  })() : ExtendsResult.False;
}
function FromObject(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsRecord(right) ? FromRecordRight(left, right) : !type_exports.IsObject(right) ? ExtendsResult.False : (() => {
    for (const key of Object.getOwnPropertyNames(right.properties)) {
      if (!(key in left.properties) && !type_exports.IsOptional(right.properties[key])) {
        return ExtendsResult.False;
      }
      if (type_exports.IsOptional(right.properties[key])) {
        return ExtendsResult.True;
      }
      if (Property(left.properties[key], right.properties[key]) === ExtendsResult.False) {
        return ExtendsResult.False;
      }
    }
    return ExtendsResult.True;
  })();
}
function FromPromise2(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) && IsObjectPromiseLike(right) ? ExtendsResult.True : !type_exports.IsPromise(right) ? ExtendsResult.False : IntoBooleanResult(Visit3(left.item, right.item));
}
function RecordKey(schema) {
  return PatternNumberExact in schema.patternProperties ? Number2() : PatternStringExact in schema.patternProperties ? String2() : Throw("Unknown record key pattern");
}
function RecordValue(schema) {
  return PatternNumberExact in schema.patternProperties ? schema.patternProperties[PatternNumberExact] : PatternStringExact in schema.patternProperties ? schema.patternProperties[PatternStringExact] : Throw("Unable to get record value schema");
}
function FromRecordRight(left, right) {
  const [Key, Value] = [RecordKey(right), RecordValue(right)];
  return type_exports.IsLiteralString(left) && type_exports.IsNumber(Key) && IntoBooleanResult(Visit3(left, Value)) === ExtendsResult.True ? ExtendsResult.True : type_exports.IsUint8Array(left) && type_exports.IsNumber(Key) ? Visit3(left, Value) : type_exports.IsString(left) && type_exports.IsNumber(Key) ? Visit3(left, Value) : type_exports.IsArray(left) && type_exports.IsNumber(Key) ? Visit3(left, Value) : type_exports.IsObject(left) ? (() => {
    for (const key of Object.getOwnPropertyNames(left.properties)) {
      if (Property(Value, left.properties[key]) === ExtendsResult.False) {
        return ExtendsResult.False;
      }
    }
    return ExtendsResult.True;
  })() : ExtendsResult.False;
}
function FromRecord(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : !type_exports.IsRecord(right) ? ExtendsResult.False : Visit3(RecordValue(left), RecordValue(right));
}
function FromRegExp(left, right) {
  const L = type_exports.IsRegExp(left) ? String2() : left;
  const R = type_exports.IsRegExp(right) ? String2() : right;
  return Visit3(L, R);
}
function FromStringRight(left, right) {
  return type_exports.IsLiteral(left) && value_exports.IsString(left.const) ? ExtendsResult.True : type_exports.IsString(left) ? ExtendsResult.True : ExtendsResult.False;
}
function FromString(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsRecord(right) ? FromRecordRight(left, right) : type_exports.IsString(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromSymbol(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsRecord(right) ? FromRecordRight(left, right) : type_exports.IsSymbol(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromTemplateLiteral2(left, right) {
  return type_exports.IsTemplateLiteral(left) ? Visit3(TemplateLiteralToUnion(left), right) : type_exports.IsTemplateLiteral(right) ? Visit3(left, TemplateLiteralToUnion(right)) : Throw("Invalid fallthrough for TemplateLiteral");
}
function IsArrayOfTuple(left, right) {
  return type_exports.IsArray(right) && left.items !== void 0 && left.items.every((schema) => Visit3(schema, right.items) === ExtendsResult.True);
}
function FromTupleRight(left, right) {
  return type_exports.IsNever(left) ? ExtendsResult.True : type_exports.IsUnknown(left) ? ExtendsResult.False : type_exports.IsAny(left) ? ExtendsResult.Union : ExtendsResult.False;
}
function FromTuple3(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) && IsObjectArrayLike(right) ? ExtendsResult.True : type_exports.IsArray(right) && IsArrayOfTuple(left, right) ? ExtendsResult.True : !type_exports.IsTuple(right) ? ExtendsResult.False : value_exports.IsUndefined(left.items) && !value_exports.IsUndefined(right.items) || !value_exports.IsUndefined(left.items) && value_exports.IsUndefined(right.items) ? ExtendsResult.False : value_exports.IsUndefined(left.items) && !value_exports.IsUndefined(right.items) ? ExtendsResult.True : left.items.every((schema, index) => Visit3(schema, right.items[index]) === ExtendsResult.True) ? ExtendsResult.True : ExtendsResult.False;
}
function FromUint8Array(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsRecord(right) ? FromRecordRight(left, right) : type_exports.IsUint8Array(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromUndefined(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsRecord(right) ? FromRecordRight(left, right) : type_exports.IsVoid(right) ? FromVoidRight(left, right) : type_exports.IsUndefined(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromUnionRight(left, right) {
  return right.anyOf.some((schema) => Visit3(left, schema) === ExtendsResult.True) ? ExtendsResult.True : ExtendsResult.False;
}
function FromUnion6(left, right) {
  return left.anyOf.every((schema) => Visit3(schema, right) === ExtendsResult.True) ? ExtendsResult.True : ExtendsResult.False;
}
function FromUnknownRight(left, right) {
  return ExtendsResult.True;
}
function FromUnknown(left, right) {
  return type_exports.IsNever(right) ? FromNeverRight(left, right) : type_exports.IsIntersect(right) ? FromIntersectRight(left, right) : type_exports.IsUnion(right) ? FromUnionRight(left, right) : type_exports.IsAny(right) ? FromAnyRight(left, right) : type_exports.IsString(right) ? FromStringRight(left, right) : type_exports.IsNumber(right) ? FromNumberRight(left, right) : type_exports.IsInteger(right) ? FromIntegerRight(left, right) : type_exports.IsBoolean(right) ? FromBooleanRight(left, right) : type_exports.IsArray(right) ? FromArrayRight(left, right) : type_exports.IsTuple(right) ? FromTupleRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsUnknown(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromVoidRight(left, right) {
  return type_exports.IsUndefined(left) ? ExtendsResult.True : type_exports.IsUndefined(left) ? ExtendsResult.True : ExtendsResult.False;
}
function FromVoid(left, right) {
  return type_exports.IsIntersect(right) ? FromIntersectRight(left, right) : type_exports.IsUnion(right) ? FromUnionRight(left, right) : type_exports.IsUnknown(right) ? FromUnknownRight(left, right) : type_exports.IsAny(right) ? FromAnyRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsVoid(right) ? ExtendsResult.True : ExtendsResult.False;
}
function Visit3(left, right) {
  return (
    // resolvable
    type_exports.IsTemplateLiteral(left) || type_exports.IsTemplateLiteral(right) ? FromTemplateLiteral2(left, right) : type_exports.IsRegExp(left) || type_exports.IsRegExp(right) ? FromRegExp(left, right) : type_exports.IsNot(left) || type_exports.IsNot(right) ? FromNot(left, right) : (
      // standard
      type_exports.IsAny(left) ? FromAny(left, right) : type_exports.IsArray(left) ? FromArray4(left, right) : type_exports.IsBigInt(left) ? FromBigInt(left, right) : type_exports.IsBoolean(left) ? FromBoolean(left, right) : type_exports.IsAsyncIterator(left) ? FromAsyncIterator(left, right) : type_exports.IsConstructor(left) ? FromConstructor(left, right) : type_exports.IsDate(left) ? FromDate(left, right) : type_exports.IsFunction(left) ? FromFunction(left, right) : type_exports.IsInteger(left) ? FromInteger(left, right) : type_exports.IsIntersect(left) ? FromIntersect4(left, right) : type_exports.IsIterator(left) ? FromIterator(left, right) : type_exports.IsLiteral(left) ? FromLiteral2(left, right) : type_exports.IsNever(left) ? FromNever(left, right) : type_exports.IsNull(left) ? FromNull(left, right) : type_exports.IsNumber(left) ? FromNumber(left, right) : type_exports.IsObject(left) ? FromObject(left, right) : type_exports.IsRecord(left) ? FromRecord(left, right) : type_exports.IsString(left) ? FromString(left, right) : type_exports.IsSymbol(left) ? FromSymbol(left, right) : type_exports.IsTuple(left) ? FromTuple3(left, right) : type_exports.IsPromise(left) ? FromPromise2(left, right) : type_exports.IsUint8Array(left) ? FromUint8Array(left, right) : type_exports.IsUndefined(left) ? FromUndefined(left, right) : type_exports.IsUnion(left) ? FromUnion6(left, right) : type_exports.IsUnknown(left) ? FromUnknown(left, right) : type_exports.IsVoid(left) ? FromVoid(left, right) : Throw(`Unknown left type operand '${left[Kind]}'`)
    )
  );
}
function ExtendsCheck(left, right) {
  return Visit3(left, right);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/extends/extends-from-mapped-result.mjs
function FromProperties8(P, Right, True, False, options) {
  const Acc = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(P))
    Acc[K2] = Extends(P[K2], Right, True, False, Clone(options));
  return Acc;
}
function FromMappedResult6(Left, Right, True, False, options) {
  return FromProperties8(Left.properties, Right, True, False, options);
}
function ExtendsFromMappedResult(Left, Right, True, False, options) {
  const P = FromMappedResult6(Left, Right, True, False, options);
  return MappedResult(P);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/extends/extends.mjs
function ExtendsResolve(left, right, trueType, falseType) {
  const R = ExtendsCheck(left, right);
  return R === ExtendsResult.Union ? Union([trueType, falseType]) : R === ExtendsResult.True ? trueType : falseType;
}
function Extends(L, R, T, F, options) {
  return IsMappedResult(L) ? ExtendsFromMappedResult(L, R, T, F, options) : IsMappedKey(L) ? CreateType(ExtendsFromMappedKey(L, R, T, F, options)) : CreateType(ExtendsResolve(L, R, T, F), options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/extends/extends-from-mapped-key.mjs
function FromPropertyKey(K, U, L, R, options) {
  return {
    [K]: Extends(Literal(K), U, L, R, Clone(options))
  };
}
function FromPropertyKeys(K, U, L, R, options) {
  return K.reduce((Acc, LK) => {
    return { ...Acc, ...FromPropertyKey(LK, U, L, R, options) };
  }, {});
}
function FromMappedKey2(K, U, L, R, options) {
  return FromPropertyKeys(K.keys, U, L, R, options);
}
function ExtendsFromMappedKey(T, U, L, R, options) {
  const P = FromMappedKey2(T, U, L, R, options);
  return MappedResult(P);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/exclude/exclude-from-template-literal.mjs
function ExcludeFromTemplateLiteral(L, R) {
  return Exclude(TemplateLiteralToUnion(L), R);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/exclude/exclude.mjs
function ExcludeRest(L, R) {
  const excluded = L.filter((inner) => ExtendsCheck(inner, R) === ExtendsResult.False);
  return excluded.length === 1 ? excluded[0] : Union(excluded);
}
function Exclude(L, R, options = {}) {
  if (IsTemplateLiteral(L))
    return CreateType(ExcludeFromTemplateLiteral(L, R), options);
  if (IsMappedResult(L))
    return CreateType(ExcludeFromMappedResult(L, R), options);
  return CreateType(IsUnion(L) ? ExcludeRest(L.anyOf, R) : ExtendsCheck(L, R) !== ExtendsResult.False ? Never() : L, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/exclude/exclude-from-mapped-result.mjs
function FromProperties9(P, U) {
  const Acc = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(P))
    Acc[K2] = Exclude(P[K2], U);
  return Acc;
}
function FromMappedResult7(R, T) {
  return FromProperties9(R.properties, T);
}
function ExcludeFromMappedResult(R, T) {
  const P = FromMappedResult7(R, T);
  return MappedResult(P);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/extract/extract-from-template-literal.mjs
function ExtractFromTemplateLiteral(L, R) {
  return Extract(TemplateLiteralToUnion(L), R);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/extract/extract.mjs
function ExtractRest(L, R) {
  const extracted = L.filter((inner) => ExtendsCheck(inner, R) !== ExtendsResult.False);
  return extracted.length === 1 ? extracted[0] : Union(extracted);
}
function Extract(L, R, options) {
  if (IsTemplateLiteral(L))
    return CreateType(ExtractFromTemplateLiteral(L, R), options);
  if (IsMappedResult(L))
    return CreateType(ExtractFromMappedResult(L, R), options);
  return CreateType(IsUnion(L) ? ExtractRest(L.anyOf, R) : ExtendsCheck(L, R) !== ExtendsResult.False ? L : Never(), options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/extract/extract-from-mapped-result.mjs
function FromProperties10(P, T) {
  const Acc = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(P))
    Acc[K2] = Extract(P[K2], T);
  return Acc;
}
function FromMappedResult8(R, T) {
  return FromProperties10(R.properties, T);
}
function ExtractFromMappedResult(R, T) {
  const P = FromMappedResult8(R, T);
  return MappedResult(P);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/instance-type/instance-type.mjs
function InstanceType(schema, options) {
  return IsConstructor(schema) ? CreateType(schema.returns, options) : Never(options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/readonly-optional/readonly-optional.mjs
function ReadonlyOptional(schema) {
  return Readonly(Optional(schema));
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/record/record.mjs
function RecordCreateFromPattern(pattern, T, options) {
  return CreateType({ [Kind]: "Record", type: "object", patternProperties: { [pattern]: T } }, options);
}
function RecordCreateFromKeys(K, T, options) {
  const result2 = {};
  for (const K2 of K)
    result2[K2] = T;
  return Object2(result2, { ...options, [Hint]: "Record" });
}
function FromTemplateLiteralKey(K, T, options) {
  return IsTemplateLiteralFinite(K) ? RecordCreateFromKeys(IndexPropertyKeys(K), T, options) : RecordCreateFromPattern(K.pattern, T, options);
}
function FromUnionKey(key, type, options) {
  return RecordCreateFromKeys(IndexPropertyKeys(Union(key)), type, options);
}
function FromLiteralKey(key, type, options) {
  return RecordCreateFromKeys([key.toString()], type, options);
}
function FromRegExpKey(key, type, options) {
  return RecordCreateFromPattern(key.source, type, options);
}
function FromStringKey(key, type, options) {
  const pattern = IsUndefined(key.pattern) ? PatternStringExact : key.pattern;
  return RecordCreateFromPattern(pattern, type, options);
}
function FromAnyKey(_, type, options) {
  return RecordCreateFromPattern(PatternStringExact, type, options);
}
function FromNeverKey(_key, type, options) {
  return RecordCreateFromPattern(PatternNeverExact, type, options);
}
function FromBooleanKey(_key, type, options) {
  return Object2({ true: type, false: type }, options);
}
function FromIntegerKey(_key, type, options) {
  return RecordCreateFromPattern(PatternNumberExact, type, options);
}
function FromNumberKey(_, type, options) {
  return RecordCreateFromPattern(PatternNumberExact, type, options);
}
function Record(key, type, options = {}) {
  return IsUnion(key) ? FromUnionKey(key.anyOf, type, options) : IsTemplateLiteral(key) ? FromTemplateLiteralKey(key, type, options) : IsLiteral(key) ? FromLiteralKey(key.const, type, options) : IsBoolean2(key) ? FromBooleanKey(key, type, options) : IsInteger(key) ? FromIntegerKey(key, type, options) : IsNumber3(key) ? FromNumberKey(key, type, options) : IsRegExp2(key) ? FromRegExpKey(key, type, options) : IsString2(key) ? FromStringKey(key, type, options) : IsAny(key) ? FromAnyKey(key, type, options) : IsNever(key) ? FromNeverKey(key, type, options) : Never(options);
}
function RecordPattern(record2) {
  return globalThis.Object.getOwnPropertyNames(record2.patternProperties)[0];
}
function RecordKey2(type) {
  const pattern = RecordPattern(type);
  return pattern === PatternStringExact ? String2() : pattern === PatternNumberExact ? Number2() : String2({ pattern });
}
function RecordValue2(type) {
  return type.patternProperties[RecordPattern(type)];
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/instantiate/instantiate.mjs
function FromConstructor2(args, type) {
  type.parameters = FromTypes(args, type.parameters);
  type.returns = FromType(args, type.returns);
  return type;
}
function FromFunction2(args, type) {
  type.parameters = FromTypes(args, type.parameters);
  type.returns = FromType(args, type.returns);
  return type;
}
function FromIntersect5(args, type) {
  type.allOf = FromTypes(args, type.allOf);
  return type;
}
function FromUnion7(args, type) {
  type.anyOf = FromTypes(args, type.anyOf);
  return type;
}
function FromTuple4(args, type) {
  if (IsUndefined(type.items))
    return type;
  type.items = FromTypes(args, type.items);
  return type;
}
function FromArray5(args, type) {
  type.items = FromType(args, type.items);
  return type;
}
function FromAsyncIterator2(args, type) {
  type.items = FromType(args, type.items);
  return type;
}
function FromIterator2(args, type) {
  type.items = FromType(args, type.items);
  return type;
}
function FromPromise3(args, type) {
  type.item = FromType(args, type.item);
  return type;
}
function FromObject2(args, type) {
  const mappedProperties = FromProperties11(args, type.properties);
  return { ...type, ...Object2(mappedProperties) };
}
function FromRecord2(args, type) {
  const mappedKey = FromType(args, RecordKey2(type));
  const mappedValue = FromType(args, RecordValue2(type));
  const result2 = Record(mappedKey, mappedValue);
  return { ...type, ...result2 };
}
function FromArgument(args, argument) {
  return argument.index in args ? args[argument.index] : Unknown();
}
function FromProperty2(args, type) {
  const isReadonly = IsReadonly(type);
  const isOptional = IsOptional(type);
  const mapped = FromType(args, type);
  return isReadonly && isOptional ? ReadonlyOptional(mapped) : isReadonly && !isOptional ? Readonly(mapped) : !isReadonly && isOptional ? Optional(mapped) : mapped;
}
function FromProperties11(args, properties) {
  return globalThis.Object.getOwnPropertyNames(properties).reduce((result2, key) => {
    return { ...result2, [key]: FromProperty2(args, properties[key]) };
  }, {});
}
function FromTypes(args, types) {
  return types.map((type) => FromType(args, type));
}
function FromType(args, type) {
  return IsConstructor(type) ? FromConstructor2(args, type) : IsFunction2(type) ? FromFunction2(args, type) : IsIntersect(type) ? FromIntersect5(args, type) : IsUnion(type) ? FromUnion7(args, type) : IsTuple(type) ? FromTuple4(args, type) : IsArray3(type) ? FromArray5(args, type) : IsAsyncIterator2(type) ? FromAsyncIterator2(args, type) : IsIterator2(type) ? FromIterator2(args, type) : IsPromise(type) ? FromPromise3(args, type) : IsObject3(type) ? FromObject2(args, type) : IsRecord(type) ? FromRecord2(args, type) : IsArgument(type) ? FromArgument(args, type) : type;
}
function Instantiate(type, args) {
  return FromType(args, CloneType(type));
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/integer/integer.mjs
function Integer(options) {
  return CreateType({ [Kind]: "Integer", type: "integer" }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/intrinsic/intrinsic-from-mapped-key.mjs
function MappedIntrinsicPropertyKey(K, M, options) {
  return {
    [K]: Intrinsic(Literal(K), M, Clone(options))
  };
}
function MappedIntrinsicPropertyKeys(K, M, options) {
  const result2 = K.reduce((Acc, L) => {
    return { ...Acc, ...MappedIntrinsicPropertyKey(L, M, options) };
  }, {});
  return result2;
}
function MappedIntrinsicProperties(T, M, options) {
  return MappedIntrinsicPropertyKeys(T["keys"], M, options);
}
function IntrinsicFromMappedKey(T, M, options) {
  const P = MappedIntrinsicProperties(T, M, options);
  return MappedResult(P);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/intrinsic/intrinsic.mjs
function ApplyUncapitalize(value) {
  const [first, rest] = [value.slice(0, 1), value.slice(1)];
  return [first.toLowerCase(), rest].join("");
}
function ApplyCapitalize(value) {
  const [first, rest] = [value.slice(0, 1), value.slice(1)];
  return [first.toUpperCase(), rest].join("");
}
function ApplyUppercase(value) {
  return value.toUpperCase();
}
function ApplyLowercase(value) {
  return value.toLowerCase();
}
function FromTemplateLiteral3(schema, mode, options) {
  const expression = TemplateLiteralParseExact(schema.pattern);
  const finite = IsTemplateLiteralExpressionFinite(expression);
  if (!finite)
    return { ...schema, pattern: FromLiteralValue(schema.pattern, mode) };
  const strings = [...TemplateLiteralExpressionGenerate(expression)];
  const literals = strings.map((value) => Literal(value));
  const mapped = FromRest5(literals, mode);
  const union = Union(mapped);
  return TemplateLiteral([union], options);
}
function FromLiteralValue(value, mode) {
  return typeof value === "string" ? mode === "Uncapitalize" ? ApplyUncapitalize(value) : mode === "Capitalize" ? ApplyCapitalize(value) : mode === "Uppercase" ? ApplyUppercase(value) : mode === "Lowercase" ? ApplyLowercase(value) : value : value.toString();
}
function FromRest5(T, M) {
  return T.map((L) => Intrinsic(L, M));
}
function Intrinsic(schema, mode, options = {}) {
  return (
    // Intrinsic-Mapped-Inference
    IsMappedKey(schema) ? IntrinsicFromMappedKey(schema, mode, options) : (
      // Standard-Inference
      IsTemplateLiteral(schema) ? FromTemplateLiteral3(schema, mode, options) : IsUnion(schema) ? Union(FromRest5(schema.anyOf, mode), options) : IsLiteral(schema) ? Literal(FromLiteralValue(schema.const, mode), options) : (
        // Default Type
        CreateType(schema, options)
      )
    )
  );
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/intrinsic/capitalize.mjs
function Capitalize(T, options = {}) {
  return Intrinsic(T, "Capitalize", options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/intrinsic/lowercase.mjs
function Lowercase(T, options = {}) {
  return Intrinsic(T, "Lowercase", options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/intrinsic/uncapitalize.mjs
function Uncapitalize(T, options = {}) {
  return Intrinsic(T, "Uncapitalize", options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/intrinsic/uppercase.mjs
function Uppercase(T, options = {}) {
  return Intrinsic(T, "Uppercase", options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/omit/omit-from-mapped-result.mjs
function FromProperties12(properties, propertyKeys, options) {
  const result2 = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(properties))
    result2[K2] = Omit(properties[K2], propertyKeys, Clone(options));
  return result2;
}
function FromMappedResult9(mappedResult, propertyKeys, options) {
  return FromProperties12(mappedResult.properties, propertyKeys, options);
}
function OmitFromMappedResult(mappedResult, propertyKeys, options) {
  const properties = FromMappedResult9(mappedResult, propertyKeys, options);
  return MappedResult(properties);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/omit/omit.mjs
function FromIntersect6(types, propertyKeys) {
  return types.map((type) => OmitResolve(type, propertyKeys));
}
function FromUnion8(types, propertyKeys) {
  return types.map((type) => OmitResolve(type, propertyKeys));
}
function FromProperty3(properties, key) {
  const { [key]: _, ...R } = properties;
  return R;
}
function FromProperties13(properties, propertyKeys) {
  return propertyKeys.reduce((T, K2) => FromProperty3(T, K2), properties);
}
function FromObject3(type, propertyKeys, properties) {
  const options = Discard(type, [TransformKind, "$id", "required", "properties"]);
  const mappedProperties = FromProperties13(properties, propertyKeys);
  return Object2(mappedProperties, options);
}
function UnionFromPropertyKeys(propertyKeys) {
  const result2 = propertyKeys.reduce((result3, key) => IsLiteralValue(key) ? [...result3, Literal(key)] : result3, []);
  return Union(result2);
}
function OmitResolve(type, propertyKeys) {
  return IsIntersect(type) ? Intersect(FromIntersect6(type.allOf, propertyKeys)) : IsUnion(type) ? Union(FromUnion8(type.anyOf, propertyKeys)) : IsObject3(type) ? FromObject3(type, propertyKeys, type.properties) : Object2({});
}
function Omit(type, key, options) {
  const typeKey = IsArray(key) ? UnionFromPropertyKeys(key) : key;
  const propertyKeys = IsSchema(key) ? IndexPropertyKeys(key) : key;
  const isTypeRef = IsRef(type);
  const isKeyRef = IsRef(key);
  return IsMappedResult(type) ? OmitFromMappedResult(type, propertyKeys, options) : IsMappedKey(key) ? OmitFromMappedKey(type, key, options) : isTypeRef && isKeyRef ? Computed("Omit", [type, typeKey], options) : !isTypeRef && isKeyRef ? Computed("Omit", [type, typeKey], options) : isTypeRef && !isKeyRef ? Computed("Omit", [type, typeKey], options) : CreateType({ ...OmitResolve(type, propertyKeys), ...options });
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/omit/omit-from-mapped-key.mjs
function FromPropertyKey2(type, key, options) {
  return { [key]: Omit(type, [key], Clone(options)) };
}
function FromPropertyKeys2(type, propertyKeys, options) {
  return propertyKeys.reduce((Acc, LK) => {
    return { ...Acc, ...FromPropertyKey2(type, LK, options) };
  }, {});
}
function FromMappedKey3(type, mappedKey, options) {
  return FromPropertyKeys2(type, mappedKey.keys, options);
}
function OmitFromMappedKey(type, mappedKey, options) {
  const properties = FromMappedKey3(type, mappedKey, options);
  return MappedResult(properties);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/pick/pick-from-mapped-result.mjs
function FromProperties14(properties, propertyKeys, options) {
  const result2 = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(properties))
    result2[K2] = Pick(properties[K2], propertyKeys, Clone(options));
  return result2;
}
function FromMappedResult10(mappedResult, propertyKeys, options) {
  return FromProperties14(mappedResult.properties, propertyKeys, options);
}
function PickFromMappedResult(mappedResult, propertyKeys, options) {
  const properties = FromMappedResult10(mappedResult, propertyKeys, options);
  return MappedResult(properties);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/pick/pick.mjs
function FromIntersect7(types, propertyKeys) {
  return types.map((type) => PickResolve(type, propertyKeys));
}
function FromUnion9(types, propertyKeys) {
  return types.map((type) => PickResolve(type, propertyKeys));
}
function FromProperties15(properties, propertyKeys) {
  const result2 = {};
  for (const K2 of propertyKeys)
    if (K2 in properties)
      result2[K2] = properties[K2];
  return result2;
}
function FromObject4(Type2, keys, properties) {
  const options = Discard(Type2, [TransformKind, "$id", "required", "properties"]);
  const mappedProperties = FromProperties15(properties, keys);
  return Object2(mappedProperties, options);
}
function UnionFromPropertyKeys2(propertyKeys) {
  const result2 = propertyKeys.reduce((result3, key) => IsLiteralValue(key) ? [...result3, Literal(key)] : result3, []);
  return Union(result2);
}
function PickResolve(type, propertyKeys) {
  return IsIntersect(type) ? Intersect(FromIntersect7(type.allOf, propertyKeys)) : IsUnion(type) ? Union(FromUnion9(type.anyOf, propertyKeys)) : IsObject3(type) ? FromObject4(type, propertyKeys, type.properties) : Object2({});
}
function Pick(type, key, options) {
  const typeKey = IsArray(key) ? UnionFromPropertyKeys2(key) : key;
  const propertyKeys = IsSchema(key) ? IndexPropertyKeys(key) : key;
  const isTypeRef = IsRef(type);
  const isKeyRef = IsRef(key);
  return IsMappedResult(type) ? PickFromMappedResult(type, propertyKeys, options) : IsMappedKey(key) ? PickFromMappedKey(type, key, options) : isTypeRef && isKeyRef ? Computed("Pick", [type, typeKey], options) : !isTypeRef && isKeyRef ? Computed("Pick", [type, typeKey], options) : isTypeRef && !isKeyRef ? Computed("Pick", [type, typeKey], options) : CreateType({ ...PickResolve(type, propertyKeys), ...options });
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/pick/pick-from-mapped-key.mjs
function FromPropertyKey3(type, key, options) {
  return {
    [key]: Pick(type, [key], Clone(options))
  };
}
function FromPropertyKeys3(type, propertyKeys, options) {
  return propertyKeys.reduce((result2, leftKey) => {
    return { ...result2, ...FromPropertyKey3(type, leftKey, options) };
  }, {});
}
function FromMappedKey4(type, mappedKey, options) {
  return FromPropertyKeys3(type, mappedKey.keys, options);
}
function PickFromMappedKey(type, mappedKey, options) {
  const properties = FromMappedKey4(type, mappedKey, options);
  return MappedResult(properties);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/partial/partial.mjs
function FromComputed3(target, parameters) {
  return Computed("Partial", [Computed(target, parameters)]);
}
function FromRef3($ref) {
  return Computed("Partial", [Ref($ref)]);
}
function FromProperties16(properties) {
  const partialProperties = {};
  for (const K of globalThis.Object.getOwnPropertyNames(properties))
    partialProperties[K] = Optional(properties[K]);
  return partialProperties;
}
function FromObject5(type, properties) {
  const options = Discard(type, [TransformKind, "$id", "required", "properties"]);
  const mappedProperties = FromProperties16(properties);
  return Object2(mappedProperties, options);
}
function FromRest6(types) {
  return types.map((type) => PartialResolve(type));
}
function PartialResolve(type) {
  return (
    // Mappable
    IsComputed(type) ? FromComputed3(type.target, type.parameters) : IsRef(type) ? FromRef3(type.$ref) : IsIntersect(type) ? Intersect(FromRest6(type.allOf)) : IsUnion(type) ? Union(FromRest6(type.anyOf)) : IsObject3(type) ? FromObject5(type, type.properties) : (
      // Intrinsic
      IsBigInt2(type) ? type : IsBoolean2(type) ? type : IsInteger(type) ? type : IsLiteral(type) ? type : IsNull2(type) ? type : IsNumber3(type) ? type : IsString2(type) ? type : IsSymbol2(type) ? type : IsUndefined3(type) ? type : (
        // Passthrough
        Object2({})
      )
    )
  );
}
function Partial(type, options) {
  if (IsMappedResult(type)) {
    return PartialFromMappedResult(type, options);
  } else {
    return CreateType({ ...PartialResolve(type), ...options });
  }
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/partial/partial-from-mapped-result.mjs
function FromProperties17(K, options) {
  const Acc = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(K))
    Acc[K2] = Partial(K[K2], Clone(options));
  return Acc;
}
function FromMappedResult11(R, options) {
  return FromProperties17(R.properties, options);
}
function PartialFromMappedResult(R, options) {
  const P = FromMappedResult11(R, options);
  return MappedResult(P);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/required/required.mjs
function FromComputed4(target, parameters) {
  return Computed("Required", [Computed(target, parameters)]);
}
function FromRef4($ref) {
  return Computed("Required", [Ref($ref)]);
}
function FromProperties18(properties) {
  const requiredProperties = {};
  for (const K of globalThis.Object.getOwnPropertyNames(properties))
    requiredProperties[K] = Discard(properties[K], [OptionalKind]);
  return requiredProperties;
}
function FromObject6(type, properties) {
  const options = Discard(type, [TransformKind, "$id", "required", "properties"]);
  const mappedProperties = FromProperties18(properties);
  return Object2(mappedProperties, options);
}
function FromRest7(types) {
  return types.map((type) => RequiredResolve(type));
}
function RequiredResolve(type) {
  return (
    // Mappable
    IsComputed(type) ? FromComputed4(type.target, type.parameters) : IsRef(type) ? FromRef4(type.$ref) : IsIntersect(type) ? Intersect(FromRest7(type.allOf)) : IsUnion(type) ? Union(FromRest7(type.anyOf)) : IsObject3(type) ? FromObject6(type, type.properties) : (
      // Intrinsic
      IsBigInt2(type) ? type : IsBoolean2(type) ? type : IsInteger(type) ? type : IsLiteral(type) ? type : IsNull2(type) ? type : IsNumber3(type) ? type : IsString2(type) ? type : IsSymbol2(type) ? type : IsUndefined3(type) ? type : (
        // Passthrough
        Object2({})
      )
    )
  );
}
function Required(type, options) {
  if (IsMappedResult(type)) {
    return RequiredFromMappedResult(type, options);
  } else {
    return CreateType({ ...RequiredResolve(type), ...options });
  }
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/required/required-from-mapped-result.mjs
function FromProperties19(P, options) {
  const Acc = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(P))
    Acc[K2] = Required(P[K2], options);
  return Acc;
}
function FromMappedResult12(R, options) {
  return FromProperties19(R.properties, options);
}
function RequiredFromMappedResult(R, options) {
  const P = FromMappedResult12(R, options);
  return MappedResult(P);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/module/compute.mjs
function DereferenceParameters(moduleProperties, types) {
  return types.map((type) => {
    return IsRef(type) ? Dereference(moduleProperties, type.$ref) : FromType2(moduleProperties, type);
  });
}
function Dereference(moduleProperties, ref) {
  return ref in moduleProperties ? IsRef(moduleProperties[ref]) ? Dereference(moduleProperties, moduleProperties[ref].$ref) : FromType2(moduleProperties, moduleProperties[ref]) : Never();
}
function FromAwaited(parameters) {
  return Awaited(parameters[0]);
}
function FromIndex(parameters) {
  return Index(parameters[0], parameters[1]);
}
function FromKeyOf(parameters) {
  return KeyOf(parameters[0]);
}
function FromPartial(parameters) {
  return Partial(parameters[0]);
}
function FromOmit(parameters) {
  return Omit(parameters[0], parameters[1]);
}
function FromPick(parameters) {
  return Pick(parameters[0], parameters[1]);
}
function FromRequired(parameters) {
  return Required(parameters[0]);
}
function FromComputed5(moduleProperties, target, parameters) {
  const dereferenced = DereferenceParameters(moduleProperties, parameters);
  return target === "Awaited" ? FromAwaited(dereferenced) : target === "Index" ? FromIndex(dereferenced) : target === "KeyOf" ? FromKeyOf(dereferenced) : target === "Partial" ? FromPartial(dereferenced) : target === "Omit" ? FromOmit(dereferenced) : target === "Pick" ? FromPick(dereferenced) : target === "Required" ? FromRequired(dereferenced) : Never();
}
function FromArray6(moduleProperties, type) {
  return Array2(FromType2(moduleProperties, type));
}
function FromAsyncIterator3(moduleProperties, type) {
  return AsyncIterator(FromType2(moduleProperties, type));
}
function FromConstructor3(moduleProperties, parameters, instanceType) {
  return Constructor(FromTypes2(moduleProperties, parameters), FromType2(moduleProperties, instanceType));
}
function FromFunction3(moduleProperties, parameters, returnType) {
  return Function2(FromTypes2(moduleProperties, parameters), FromType2(moduleProperties, returnType));
}
function FromIntersect8(moduleProperties, types) {
  return Intersect(FromTypes2(moduleProperties, types));
}
function FromIterator3(moduleProperties, type) {
  return Iterator(FromType2(moduleProperties, type));
}
function FromObject7(moduleProperties, properties) {
  return Object2(globalThis.Object.keys(properties).reduce((result2, key) => {
    return { ...result2, [key]: FromType2(moduleProperties, properties[key]) };
  }, {}));
}
function FromRecord3(moduleProperties, type) {
  const [value, pattern] = [FromType2(moduleProperties, RecordValue2(type)), RecordPattern(type)];
  const result2 = CloneType(type);
  result2.patternProperties[pattern] = value;
  return result2;
}
function FromTransform(moduleProperties, transform) {
  return IsRef(transform) ? { ...Dereference(moduleProperties, transform.$ref), [TransformKind]: transform[TransformKind] } : transform;
}
function FromTuple5(moduleProperties, types) {
  return Tuple(FromTypes2(moduleProperties, types));
}
function FromUnion10(moduleProperties, types) {
  return Union(FromTypes2(moduleProperties, types));
}
function FromTypes2(moduleProperties, types) {
  return types.map((type) => FromType2(moduleProperties, type));
}
function FromType2(moduleProperties, type) {
  return (
    // Modifiers
    IsOptional(type) ? CreateType(FromType2(moduleProperties, Discard(type, [OptionalKind])), type) : IsReadonly(type) ? CreateType(FromType2(moduleProperties, Discard(type, [ReadonlyKind])), type) : (
      // Transform
      IsTransform(type) ? CreateType(FromTransform(moduleProperties, type), type) : (
        // Types
        IsArray3(type) ? CreateType(FromArray6(moduleProperties, type.items), type) : IsAsyncIterator2(type) ? CreateType(FromAsyncIterator3(moduleProperties, type.items), type) : IsComputed(type) ? CreateType(FromComputed5(moduleProperties, type.target, type.parameters)) : IsConstructor(type) ? CreateType(FromConstructor3(moduleProperties, type.parameters, type.returns), type) : IsFunction2(type) ? CreateType(FromFunction3(moduleProperties, type.parameters, type.returns), type) : IsIntersect(type) ? CreateType(FromIntersect8(moduleProperties, type.allOf), type) : IsIterator2(type) ? CreateType(FromIterator3(moduleProperties, type.items), type) : IsObject3(type) ? CreateType(FromObject7(moduleProperties, type.properties), type) : IsRecord(type) ? CreateType(FromRecord3(moduleProperties, type)) : IsTuple(type) ? CreateType(FromTuple5(moduleProperties, type.items || []), type) : IsUnion(type) ? CreateType(FromUnion10(moduleProperties, type.anyOf), type) : type
      )
    )
  );
}
function ComputeType(moduleProperties, key) {
  return key in moduleProperties ? FromType2(moduleProperties, moduleProperties[key]) : Never();
}
function ComputeModuleProperties(moduleProperties) {
  return globalThis.Object.getOwnPropertyNames(moduleProperties).reduce((result2, key) => {
    return { ...result2, [key]: ComputeType(moduleProperties, key) };
  }, {});
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/module/module.mjs
var TModule = class {
  constructor($defs) {
    const computed = ComputeModuleProperties($defs);
    const identified = this.WithIdentifiers(computed);
    this.$defs = identified;
  }
  /** `[Json]` Imports a Type by Key. */
  Import(key, options) {
    const $defs = { ...this.$defs, [key]: CreateType(this.$defs[key], options) };
    return CreateType({ [Kind]: "Import", $defs, $ref: key });
  }
  // prettier-ignore
  WithIdentifiers($defs) {
    return globalThis.Object.getOwnPropertyNames($defs).reduce((result2, key) => {
      return { ...result2, [key]: { ...$defs[key], $id: key } };
    }, {});
  }
};
function Module(properties) {
  return new TModule(properties);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/not/not.mjs
function Not(type, options) {
  return CreateType({ [Kind]: "Not", not: type }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/parameters/parameters.mjs
function Parameters(schema, options) {
  return IsFunction2(schema) ? Tuple(schema.parameters, options) : Never();
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/recursive/recursive.mjs
var Ordinal = 0;
function Recursive(callback, options = {}) {
  if (IsUndefined(options.$id))
    options.$id = `T${Ordinal++}`;
  const thisType = CloneType(callback({ [Kind]: "This", $ref: `${options.$id}` }));
  thisType.$id = options.$id;
  return CreateType({ [Hint]: "Recursive", ...thisType }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/regexp/regexp.mjs
function RegExp2(unresolved, options) {
  const expr = IsString(unresolved) ? new globalThis.RegExp(unresolved) : unresolved;
  return CreateType({ [Kind]: "RegExp", type: "RegExp", source: expr.source, flags: expr.flags }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/rest/rest.mjs
function RestResolve(T) {
  return IsIntersect(T) ? T.allOf : IsUnion(T) ? T.anyOf : IsTuple(T) ? T.items ?? [] : [];
}
function Rest(T) {
  return RestResolve(T);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/return-type/return-type.mjs
function ReturnType(schema, options) {
  return IsFunction2(schema) ? CreateType(schema.returns, options) : Never(options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/transform/transform.mjs
var TransformDecodeBuilder = class {
  constructor(schema) {
    this.schema = schema;
  }
  Decode(decode) {
    return new TransformEncodeBuilder(this.schema, decode);
  }
};
var TransformEncodeBuilder = class {
  constructor(schema, decode) {
    this.schema = schema;
    this.decode = decode;
  }
  EncodeTransform(encode, schema) {
    const Encode = (value) => schema[TransformKind].Encode(encode(value));
    const Decode = (value) => this.decode(schema[TransformKind].Decode(value));
    const Codec = { Encode, Decode };
    return { ...schema, [TransformKind]: Codec };
  }
  EncodeSchema(encode, schema) {
    const Codec = { Decode: this.decode, Encode: encode };
    return { ...schema, [TransformKind]: Codec };
  }
  Encode(encode) {
    return IsTransform(this.schema) ? this.EncodeTransform(encode, this.schema) : this.EncodeSchema(encode, this.schema);
  }
};
function Transform(schema) {
  return new TransformDecodeBuilder(schema);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/unsafe/unsafe.mjs
function Unsafe(options = {}) {
  return CreateType({ [Kind]: options[Kind] ?? "Unsafe" }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/void/void.mjs
function Void(options) {
  return CreateType({ [Kind]: "Void", type: "void" }, options);
}

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/type/type.mjs
var type_exports2 = {};
__export(type_exports2, {
  Any: () => Any,
  Argument: () => Argument,
  Array: () => Array2,
  AsyncIterator: () => AsyncIterator,
  Awaited: () => Awaited,
  BigInt: () => BigInt,
  Boolean: () => Boolean,
  Capitalize: () => Capitalize,
  Composite: () => Composite,
  Const: () => Const,
  Constructor: () => Constructor,
  ConstructorParameters: () => ConstructorParameters,
  Date: () => Date2,
  Enum: () => Enum,
  Exclude: () => Exclude,
  Extends: () => Extends,
  Extract: () => Extract,
  Function: () => Function2,
  Index: () => Index,
  InstanceType: () => InstanceType,
  Instantiate: () => Instantiate,
  Integer: () => Integer,
  Intersect: () => Intersect,
  Iterator: () => Iterator,
  KeyOf: () => KeyOf,
  Literal: () => Literal,
  Lowercase: () => Lowercase,
  Mapped: () => Mapped,
  Module: () => Module,
  Never: () => Never,
  Not: () => Not,
  Null: () => Null,
  Number: () => Number2,
  Object: () => Object2,
  Omit: () => Omit,
  Optional: () => Optional,
  Parameters: () => Parameters,
  Partial: () => Partial,
  Pick: () => Pick,
  Promise: () => Promise2,
  Readonly: () => Readonly,
  ReadonlyOptional: () => ReadonlyOptional,
  Record: () => Record,
  Recursive: () => Recursive,
  Ref: () => Ref,
  RegExp: () => RegExp2,
  Required: () => Required,
  Rest: () => Rest,
  ReturnType: () => ReturnType,
  String: () => String2,
  Symbol: () => Symbol2,
  TemplateLiteral: () => TemplateLiteral,
  Transform: () => Transform,
  Tuple: () => Tuple,
  Uint8Array: () => Uint8Array2,
  Uncapitalize: () => Uncapitalize,
  Undefined: () => Undefined,
  Union: () => Union,
  Unknown: () => Unknown,
  Unsafe: () => Unsafe,
  Uppercase: () => Uppercase,
  Void: () => Void
});

// ../../../../Users/adam/dev/hls-uk/single-controller-engineer/node_modules/@sinclair/typebox/build/esm/type/type/index.mjs
var Type = type_exports2;

// src/commands/index.ts
var import_ajv4 = __toESM(require_ajv(), 1);

// src/protocol/schemas.ts
var import_ajv = __toESM(require_ajv(), 1);
var SCHEMA_VERSION = 1;
var LIMITS = {
  envelopeBytes: 131072,
  effectJournal: 256,
  eventHistory: 256,
  // 64 units can each retain an initial worker/reviewer pair plus all 16
  // bounded repair pairs without permitting historical session reuse.
  sessionHistory: 2176,
  sessionFingerprintBytes: 32,
  units: 64,
  reservations: 128,
  text: 8192,
  findings: 64
};
var utf8 = new TextEncoder();
var identifier = () => Type.String({
  minLength: 1,
  maxLength: 160,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
});
var effectIdentifier = () => Type.String({
  minLength: 1,
  // An emitted effect id is `${eventId}:${effectKind}`. Event IDs retain
  // the shared 160-character identifier vocabulary.
  maxLength: 192,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
});
var controllerHolder = () => Type.String({
  minLength: 3,
  // Immutable holder is the exact `${runId}/${incarnationId}` pair.
  maxLength: 321,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
});
var idempotencyKey = () => Type.String({
  minLength: 1,
  maxLength: 160,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
});
var revision = () => Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
var oid = () => Type.String({
  minLength: 40,
  maxLength: 64,
  pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$"
});
var hash = () => Type.String({ minLength: 64, maxLength: 64, pattern: "^[0-9a-f]{64}$" });
var text = (minLength = 1) => Type.String({
  minLength,
  maxLength: LIMITS.text,
  maxUtf8Bytes: LIMITS.text
});
var nullableIdentifier = () => Type.Union([identifier(), Type.Null()]);
function strictObject(properties) {
  return Type.Object(properties, { additionalProperties: false });
}
var EffectStatusSchema = Type.Union([
  Type.Literal("intended"),
  Type.Literal("observed"),
  Type.Literal("ambiguous")
]);
var EffectKindSchema = Type.Union([
  Type.Literal("controller_acquire"),
  Type.Literal("reservation_acquire"),
  Type.Literal("branch_create"),
  Type.Literal("worktree_create"),
  Type.Literal("dispatch"),
  Type.Literal("worker_collect"),
  Type.Literal("candidate_collect"),
  Type.Literal("verify"),
  Type.Literal("review_dispatch"),
  Type.Literal("review_collect"),
  Type.Literal("publish"),
  Type.Literal("integrate"),
  Type.Literal("reservation_release"),
  Type.Literal("repair"),
  Type.Literal("failure"),
  Type.Literal("timeout"),
  Type.Literal("park"),
  Type.Literal("cancel"),
  Type.Literal("controller_release")
]);
var SlotScopeSchema = strictObject({
  beadsStoreIdentity: identifier(),
  gitRepositoryIdentity: identifier(),
  integrationBranch: identifier()
});
var SlotObservationSchema = strictObject({
  actor: controllerHolder(),
  holder: Type.Optional(controllerHolder()),
  label: Type.Literal("gt:slot"),
  readbackHash: hash(),
  scope: SlotScopeSchema,
  scopeCommitment: hash(),
  slotId: identifier(),
  status: Type.Union([Type.Literal("available"), Type.Literal("acquired")]),
  title: Type.Literal("Merge Slot"),
  version: Type.Literal(1)
});
var EmbeddedSlotTransitionIntentSchema = strictObject({
  after: SlotObservationSchema,
  before: strictObject({
    head: Type.String({ minLength: 20, maxLength: 64, pattern: "^[0-9a-z]+$" }),
    remoteHead: Type.Optional(
      Type.String({ minLength: 20, maxLength: 64, pattern: "^[0-9a-z]+$" })
    ),
    slot: SlotObservationSchema
  }),
  holder: controllerHolder(),
  idempotencyKey: hash(),
  kind: Type.Union([Type.Literal("acquire"), Type.Literal("release")]),
  schema: Type.Literal("sce.beads-embedded.slot-transition"),
  scope: SlotScopeSchema,
  version: Type.Literal(1)
});
var ServerSlotTransitionIntentSchema = strictObject({
  after: SlotObservationSchema,
  before: SlotObservationSchema,
  holder: controllerHolder(),
  idempotencyKey: hash(),
  kind: Type.Union([Type.Literal("acquire"), Type.Literal("release")]),
  precondition: strictObject({
    kind: Type.Union([Type.Literal("available"), Type.Literal("held")]),
    observationHash: hash()
  }),
  schema: Type.Literal("sce.beads-server.slot-transition"),
  scope: SlotScopeSchema,
  topology: Type.Literal("shared-server"),
  version: Type.Literal(1)
});
var SlotTransitionIntentSchema = Type.Union([
  EmbeddedSlotTransitionIntentSchema,
  ServerSlotTransitionIntentSchema
]);
var EffectJournalEntrySchema = strictObject({
  effectId: effectIdentifier(),
  unitId: nullableIdentifier(),
  idempotencyKey: idempotencyKey(),
  kind: EffectKindSchema,
  intentRevision: revision(),
  intentCommitment: hash(),
  paramsHash: hash(),
  // Present only for controller slot acts.  This binds all before/after slot
  // facts and heads durably before the adapter is invoked.
  slotTransition: Type.Optional(SlotTransitionIntentSchema),
  status: EffectStatusSchema,
  observationHash: Type.Optional(hash()),
  schemaVersion: Type.Literal(SCHEMA_VERSION)
});
var ReservationStateSchema = Type.Union([
  Type.Literal("intended"),
  Type.Literal("reserved"),
  Type.Literal("release_intent"),
  Type.Literal("released")
]);
var ReservationSchema = strictObject({
  id: identifier(),
  unitId: identifier(),
  namespace: identifier(),
  resource: identifier(),
  state: ReservationStateSchema,
  acquireEffectId: Type.Optional(effectIdentifier()),
  releaseEffectId: Type.Optional(effectIdentifier())
});
var UnitStateSchema = Type.Union([
  Type.Literal("planned"),
  Type.Literal("reservation_intent"),
  Type.Literal("resources_reserved"),
  Type.Literal("branch_intent"),
  Type.Literal("branch_observed"),
  Type.Literal("worktree_intent"),
  Type.Literal("worktree_observed"),
  Type.Literal("dispatch_intent"),
  Type.Literal("dispatched"),
  Type.Literal("collect_intent"),
  Type.Literal("collected"),
  Type.Literal("candidate_intent"),
  Type.Literal("candidate_committed"),
  Type.Literal("verification_intent"),
  Type.Literal("qualified"),
  Type.Literal("reviewer_dispatch_intent"),
  Type.Literal("reviewer_dispatched"),
  Type.Literal("review_collect_intent"),
  Type.Literal("approved"),
  Type.Literal("publish_intent"),
  Type.Literal("published"),
  Type.Literal("integrate_intent"),
  Type.Literal("landed"),
  Type.Literal("handoff"),
  Type.Literal("reservation_release_intent"),
  Type.Literal("repair_required"),
  Type.Literal("repair_intent"),
  Type.Literal("failure_intent"),
  Type.Literal("failed"),
  Type.Literal("timeout_intent"),
  Type.Literal("timed_out"),
  Type.Literal("park_intent"),
  Type.Literal("parked"),
  Type.Literal("cancel_intent"),
  Type.Literal("cancelled"),
  Type.Literal("blocked"),
  Type.Literal("closed")
]);
var RepairContextSchema = strictObject({
  baseOid: oid(),
  // A worker can request a repair before a clean candidate exists. Review and
  // runtime contexts carry the exact candidate pair; all present OIDs are
  // checked again against the repository object format during hydration.
  headOid: Type.Optional(oid()),
  treeOid: Type.Optional(oid()),
  responseHash: hash(),
  rationale: text(),
  findings: Type.Array(
    strictObject({
      id: identifier(),
      severity: Type.Union([
        Type.Literal("blocking"),
        Type.Literal("non_blocking")
      ]),
      detail: text()
    }),
    { minItems: 1, maxItems: LIMITS.findings }
  )
});
var PullRequestObservationSchema = strictObject({
  providerPrId: identifier(),
  // Provider URLs are retained only when the consuming policy permits them.
  url: Type.Optional(text()),
  state: Type.Literal("open"),
  baseRef: identifier(),
  baseOid: oid(),
  remoteHeadOid: oid()
});
var UnitSchema = strictObject({
  id: identifier(),
  // Stable at planning time and never reassigned, even after a unit leaves
  // the live map at closure. Session lineage records bind this ordinal.
  ordinal: Type.Integer({ minimum: 0, maximum: 63 }),
  revision: revision(),
  state: UnitStateSchema,
  baseOid: oid(),
  branchRef: Type.Optional(identifier()),
  worktreePath: Type.Optional(text()),
  reservationIds: Type.Array(identifier(), {
    maxItems: LIMITS.reservations,
    uniqueItems: true
  }),
  candidateHead: Type.Optional(oid()),
  candidateTree: Type.Optional(oid()),
  publishedHeadOid: Type.Optional(oid()),
  openPullRequest: Type.Optional(PullRequestObservationSchema),
  workerSessionId: Type.Optional(identifier()),
  workerRequestedModel: Type.Optional(text()),
  workerReturnedModel: Type.Optional(text()),
  workerPromptHash: Type.Optional(hash()),
  reviewerSessionId: Type.Optional(identifier()),
  reviewerRequestedModel: Type.Optional(text()),
  reviewerReturnedModel: Type.Optional(text()),
  reviewPromptHash: Type.Optional(hash()),
  verificationBaseOid: Type.Optional(oid()),
  verificationHeadOid: Type.Optional(oid()),
  verificationTree: Type.Optional(oid()),
  verificationEvidenceHash: Type.Optional(hash()),
  verificationCommands: Type.Optional(
    Type.Array(text(), { minItems: 1, maxItems: 32 })
  ),
  reviewBaseOid: Type.Optional(oid()),
  reviewHeadOid: Type.Optional(oid()),
  reviewTree: Type.Optional(oid()),
  approvalResponseHash: Type.Optional(hash()),
  landedOid: Type.Optional(oid()),
  workerResult: Type.Optional(
    strictObject({
      status: Type.Union([
        Type.Literal("completed"),
        Type.Literal("needs_repair"),
        Type.Literal("failed")
      ]),
      summary: text(),
      residualRisks: Type.Array(text(), { maxItems: 32 }),
      suggestedFollowUps: Type.Array(text(), { maxItems: 32 })
    })
  ),
  repairCount: Type.Integer({ minimum: 0, maximum: 16 }),
  repairContext: Type.Optional(RepairContextSchema)
});
var ObservedJournalEntrySchema = strictObject({
  effectId: effectIdentifier(),
  unitId: nullableIdentifier(),
  idempotencyKey: idempotencyKey(),
  kind: EffectKindSchema,
  intentRevision: revision(),
  intentCommitment: hash(),
  paramsHash: hash(),
  status: Type.Literal("observed"),
  observationHash: hash(),
  schemaVersion: Type.Literal(SCHEMA_VERSION)
});
var ClosureReservationSchema = strictObject({
  id: identifier(),
  namespace: identifier(),
  resource: identifier(),
  acquire: ObservedJournalEntrySchema,
  release: Type.Optional(
    strictObject({
      effectId: effectIdentifier(),
      unitId: nullableIdentifier(),
      idempotencyKey: idempotencyKey(),
      kind: Type.Literal("reservation_release"),
      intentRevision: revision(),
      intentCommitment: hash(),
      paramsHash: hash(),
      status: EffectStatusSchema,
      observationHash: Type.Optional(hash()),
      schemaVersion: Type.Literal(SCHEMA_VERSION)
    })
  )
});
var ClosureWorkerSchema = strictObject({
  sessionId: identifier(),
  requestedModel: text(),
  returnedModel: text(),
  promptHash: hash()
});
var ClosureReviewerSchema = strictObject({
  sessionId: identifier(),
  requestedModel: text(),
  returnedModel: text(),
  promptHash: hash()
});
var ClosureCandidateSchema = strictObject({ headOid: oid(), treeOid: oid() });
var ClosureVerificationSchema = strictObject({
  baseOid: oid(),
  headOid: oid(),
  treeOid: oid(),
  evidenceHash: hash(),
  commands: Type.Array(text(), { minItems: 1, maxItems: 32 })
});
var ClosureReviewSchema = strictObject({
  baseOid: oid(),
  headOid: oid(),
  treeOid: oid(),
  responseHash: hash()
});
var ClosureBaseSchema = {
  unitId: identifier(),
  unitOrdinal: Type.Integer({ minimum: 0, maximum: 63 }),
  baseOid: oid(),
  // While the unit is live, its required field is authoritative. At closure
  // the unit leaves the map and this record becomes the sole owner.
  repairCount: Type.Optional(Type.Integer({ minimum: 0, maximum: 16 })),
  branchRef: Type.Optional(identifier()),
  worktreePath: Type.Optional(text()),
  worker: Type.Optional(ClosureWorkerSchema),
  reviewer: Type.Optional(ClosureReviewerSchema),
  reservations: Type.Array(ClosureReservationSchema, {
    maxItems: LIMITS.reservations,
    uniqueItems: true
  }),
  terminalEffect: ObservedJournalEntrySchema
};
var ClosureSuccessSchema = {
  candidate: ClosureCandidateSchema,
  verification: ClosureVerificationSchema,
  review: ClosureReviewSchema
};
var ClosureNegativeSchema = {
  workerResult: Type.Optional(
    strictObject({
      status: Type.Union([
        Type.Literal("completed"),
        Type.Literal("needs_repair"),
        Type.Literal("failed")
      ]),
      summary: text(),
      residualRisks: Type.Array(text(), { maxItems: 32 }),
      suggestedFollowUps: Type.Array(text(), { maxItems: 32 })
    })
  ),
  repairContext: Type.Optional(RepairContextSchema),
  candidate: Type.Optional(ClosureCandidateSchema)
};
var ClosureEvidenceSchema = Type.Union([
  strictObject({
    ...ClosureBaseSchema,
    ...ClosureSuccessSchema,
    outcome: Type.Literal("landed"),
    landedOid: oid()
  }),
  strictObject({
    ...ClosureBaseSchema,
    ...ClosureSuccessSchema,
    outcome: Type.Literal("branch_handoff"),
    publishedHeadOid: oid()
  }),
  strictObject({
    ...ClosureBaseSchema,
    ...ClosureSuccessSchema,
    outcome: Type.Literal("pr_handoff"),
    publishedHeadOid: oid(),
    pullRequest: PullRequestObservationSchema
  }),
  strictObject({
    ...ClosureBaseSchema,
    ...ClosureNegativeSchema,
    outcome: Type.Literal("failed")
  }),
  strictObject({
    ...ClosureBaseSchema,
    ...ClosureNegativeSchema,
    outcome: Type.Literal("timed_out")
  }),
  strictObject({
    ...ClosureBaseSchema,
    ...ClosureNegativeSchema,
    outcome: Type.Literal("parked")
  }),
  strictObject({
    ...ClosureBaseSchema,
    ...ClosureNegativeSchema,
    outcome: Type.Literal("cancelled")
  })
]);
var AggregateStateSchema = Type.Union([
  Type.Literal("initializing"),
  Type.Literal("active"),
  Type.Literal("draining"),
  Type.Literal("release_intent"),
  Type.Literal("released"),
  Type.Literal("blocked")
]);
var AuthorityProfileSchema = Type.Union([
  Type.Literal("local-change-only"),
  Type.Literal("push-branch"),
  Type.Literal("open-pr"),
  Type.Literal("integrate")
]);
var CompletionBoundarySchema = Type.Union([
  Type.Literal("local-integration"),
  Type.Literal("branch-handoff"),
  Type.Literal("pr-handoff"),
  Type.Literal("remote-integration")
]);
var IntegrationProfileSchema = Type.Union([
  Type.Literal("none"),
  Type.Literal("local-ff"),
  Type.Literal("remote-ff")
]);
var GitObjectFormatSchema = Type.Union([
  Type.Literal("sha1"),
  Type.Literal("sha256")
]);
var WaveSchema = strictObject({
  id: identifier(),
  unitIds: Type.Array(identifier(), {
    maxItems: 3,
    uniqueItems: true
  })
});
var JournalCheckpointSchema = strictObject({
  revision: revision(),
  compactedEffects: Type.Integer({ minimum: 0 }),
  compactedEvents: Type.Integer({ minimum: 0 }),
  compactedIdempotencyKeys: Type.Integer({ minimum: 0 }),
  commitment: hash()
});
var ControllerOwnershipSchema = strictObject({
  runId: identifier(),
  incarnationId: identifier(),
  holder: controllerHolder(),
  requestedModel: text(),
  returnedModel: text(),
  promptHash: hash(),
  state: Type.Union([
    Type.Literal("unacquired"),
    Type.Literal("acquire_intent"),
    Type.Literal("acquired"),
    Type.Literal("release_intent"),
    Type.Literal("released")
  ])
});
var RepositoryRunSchema = strictObject({
  revision: revision(),
  state: AggregateStateSchema,
  storeIdentity: identifier(),
  repositoryIdentity: identifier(),
  integrationBranch: identifier(),
  authorityProfile: AuthorityProfileSchema,
  completionBoundary: CompletionBoundarySchema,
  integrationProfile: IntegrationProfileSchema,
  gitObjectFormat: GitObjectFormatSchema,
  controllerFencingToken: identifier(),
  controller: ControllerOwnershipSchema,
  units: Type.Record(identifier(), UnitSchema, {
    maxProperties: LIMITS.units,
    additionalProperties: false
  }),
  reservations: Type.Record(identifier(), ReservationSchema, {
    maxProperties: LIMITS.reservations,
    additionalProperties: false
  }),
  activeModifyingUnitIds: Type.Array(identifier(), {
    maxItems: 3,
    uniqueItems: true
  }),
  qualificationOwnerUnitId: Type.Optional(identifier()),
  integrationOwnerUnitId: Type.Optional(identifier()),
  currentReviewerUnitId: Type.Optional(identifier()),
  wave: WaveSchema,
  qualificationQueue: Type.Array(identifier(), {
    maxItems: LIMITS.units,
    uniqueItems: true
  }),
  integrationQueue: Type.Array(identifier(), {
    maxItems: LIMITS.units,
    uniqueItems: true
  }),
  effectJournal: Type.Array(EffectJournalEntrySchema, {
    maxItems: LIMITS.effectJournal
  }),
  processedEventIds: Type.Array(identifier(), {
    maxItems: LIMITS.eventHistory,
    uniqueItems: true
  }),
  processedIdempotencyKeys: Type.Array(idempotencyKey(), {
    maxItems: LIMITS.eventHistory,
    uniqueItems: true
  }),
  // Canonical binary slots: an occupancy bitmap binds each full digest to a
  // stable `(unit ordinal, worker|reviewer, generation)` position.
  usedSessionCount: Type.Integer({
    minimum: 0,
    maximum: LIMITS.sessionHistory
  }),
  sessionLineage: Type.String({
    maxLength: Math.ceil(
      (LIMITS.sessionHistory * LIMITS.sessionFingerprintBytes + Math.ceil(LIMITS.sessionHistory / 8)) / 3
    ) * 4,
    pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
  }),
  sessionLineageRoot: hash(),
  // Canonical deflate-raw JSON ledger of exact facts for closed units. The
  // live unit object stays compact after cleanup while exact OIDs/hashes are
  // retained for audit and hydration validation.
  closedUnitEvidence: Type.String({
    maxLength: LIMITS.envelopeBytes,
    pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
  }),
  // Commits the compact closed ledger itself. The ordered journal checkpoint
  // commits transitions; this converse catches mutation of its exact retained
  // audit copies after those transitions are compacted.
  closedUnitEvidenceCommitment: hash(),
  journalCheckpoint: JournalCheckpointSchema,
  journalCommitment: hash()
});
var eventBase = {
  eventId: identifier(),
  expectedRevision: revision(),
  unitId: identifier()
};
var controllerEventBase = {
  eventId: identifier(),
  expectedRevision: revision()
};
var effectIntent = { idempotencyKey: idempotencyKey() };
var observedEffect = {
  effectId: effectIdentifier(),
  effectKind: EffectKindSchema,
  observationHash: hash()
};
var session = {
  sessionId: identifier(),
  requestedModel: text(),
  returnedModel: text(),
  promptHash: hash()
};
var WorkerResultSchema = strictObject({
  status: Type.Union([
    Type.Literal("completed"),
    Type.Literal("needs_repair"),
    Type.Literal("failed")
  ]),
  summary: text(),
  residualRisks: Type.Array(text(), { maxItems: 32 }),
  suggestedFollowUps: Type.Array(text(), { maxItems: 32 })
});
var FindingSchema = strictObject({
  id: identifier(),
  severity: Type.Union([
    Type.Literal("blocking"),
    Type.Literal("non_blocking")
  ]),
  detail: text()
});
var judgmentBase = {
  schemaVersion: Type.Literal(SCHEMA_VERSION),
  sessionId: identifier(),
  requestedModel: text(),
  returnedModel: text(),
  aggregateRevision: revision(),
  promptHash: hash(),
  responseHash: hash(),
  rationale: text()
};
var ControllerJudgmentSchema = strictObject({
  ...judgmentBase,
  role: Type.Literal("controller"),
  kind: Type.Union([
    Type.Literal("decomposition"),
    Type.Literal("conflict_classification"),
    Type.Literal("additional_tests"),
    Type.Literal("qualitative_acceptance")
  ]),
  unitId: identifier(),
  factOid: oid(),
  decision: Type.Union([
    Type.Literal("accept"),
    Type.Literal("reject"),
    Type.Literal("repair"),
    Type.Literal("park"),
    Type.Literal("cancel")
  ])
});
var RepairDispositionJudgmentSchema = strictObject({
  ...judgmentBase,
  role: Type.Literal("controller"),
  kind: Type.Literal("repair_disposition"),
  unitId: identifier(),
  factOid: oid(),
  decision: Type.Literal("repair"),
  // Binds the disposition to the evidence currently retained by the unit,
  // rather than to an earlier controller prompt.
  currentEvidenceHash: hash(),
  findingsContextHash: hash()
});
var WorkerJudgmentSchema = strictObject({
  ...judgmentBase,
  role: Type.Literal("worker"),
  kind: Type.Union([
    Type.Literal("semantic_resolution"),
    Type.Literal("repair_disposition")
  ]),
  unitId: identifier(),
  factOid: oid(),
  decision: Type.Union([
    Type.Literal("repair"),
    Type.Literal("park"),
    Type.Literal("cancel")
  ])
});
var ReviewerJudgmentSchema = strictObject({
  ...judgmentBase,
  role: Type.Literal("reviewer"),
  kind: Type.Literal("review_verdict"),
  unitId: identifier(),
  baseOid: oid(),
  headOid: oid(),
  treeOid: oid(),
  decision: Type.Union([
    Type.Literal("approve"),
    Type.Literal("request_changes")
  ]),
  findings: Type.Array(FindingSchema, { maxItems: LIMITS.findings })
});
var JudgmentSchema = Type.Union([
  ControllerJudgmentSchema,
  RepairDispositionJudgmentSchema,
  WorkerJudgmentSchema,
  ReviewerJudgmentSchema
]);
var ProtocolEventSchema = Type.Union([
  strictObject({
    ...controllerEventBase,
    type: Type.Literal("controller_acquire_intent"),
    ...effectIntent,
    slotTransition: Type.Optional(SlotTransitionIntentSchema)
  }),
  strictObject({
    ...controllerEventBase,
    type: Type.Literal("controller_acquired"),
    ...observedEffect,
    holder: controllerHolder(),
    controllerFencingToken: identifier()
  }),
  strictObject({
    ...controllerEventBase,
    type: Type.Literal("controller_release_intent"),
    ...effectIntent,
    slotTransition: Type.Optional(SlotTransitionIntentSchema)
  }),
  strictObject({
    ...controllerEventBase,
    type: Type.Literal("controller_released"),
    ...observedEffect
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("reservation_intent"),
    ...effectIntent,
    reservations: Type.Array(
      strictObject({
        id: identifier(),
        namespace: identifier(),
        resource: identifier()
      }),
      { minItems: 1, maxItems: LIMITS.reservations, uniqueItems: true }
    )
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("reservation_observed"),
    ...observedEffect
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("branch_intent"),
    ...effectIntent,
    branchRef: identifier()
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("branch_observed"),
    ...observedEffect,
    branchRef: identifier()
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("worktree_intent"),
    ...effectIntent,
    worktreePath: text()
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("worktree_observed"),
    ...observedEffect,
    worktreePath: text()
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("dispatch_intent"),
    ...effectIntent,
    requestedModel: text(),
    promptHash: hash()
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("dispatch_observed"),
    ...observedEffect,
    ...session
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("collect_intent"),
    ...effectIntent
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("worker_collected"),
    ...observedEffect,
    workerResult: WorkerResultSchema
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("candidate_intent"),
    ...effectIntent
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("candidate_observed"),
    ...observedEffect,
    headOid: oid(),
    treeOid: oid()
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("verification_intent"),
    ...effectIntent,
    commands: Type.Array(text(), { minItems: 1, maxItems: 32 })
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("verification_observed"),
    ...observedEffect,
    baseOid: oid(),
    headOid: oid(),
    treeOid: oid()
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("reviewer_dispatch_intent"),
    ...effectIntent,
    requestedModel: text(),
    promptHash: hash()
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("reviewer_observed"),
    ...observedEffect,
    ...session
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("review_collect_intent"),
    ...effectIntent
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("review_collected"),
    ...observedEffect,
    judgment: ReviewerJudgmentSchema
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("publish_intent"),
    ...effectIntent
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("publish_observed"),
    ...observedEffect,
    publication: Type.Union([
      strictObject({
        kind: Type.Literal("push_branch"),
        remoteHeadOid: oid()
      }),
      strictObject({
        kind: Type.Literal("open_pr"),
        pullRequest: PullRequestObservationSchema
      })
    ])
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("integrate_intent"),
    ...effectIntent
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("integrate_observed"),
    ...observedEffect,
    baseOid: oid(),
    headOid: oid(),
    treeOid: oid(),
    integrationOid: oid(),
    controllerFencingToken: identifier()
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("reservation_release_intent"),
    ...effectIntent
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("reservation_released"),
    ...observedEffect
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("repair_intent"),
    ...effectIntent,
    judgment: RepairDispositionJudgmentSchema,
    requestedModel: text(),
    promptHash: hash()
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("repair_observed"),
    ...observedEffect,
    ...session
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("failure_intent"),
    ...effectIntent
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("failure_observed"),
    ...observedEffect
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("timeout_intent"),
    ...effectIntent
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("timeout_observed"),
    ...observedEffect
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("park_intent"),
    ...effectIntent
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("park_observed"),
    ...observedEffect
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("cancel_intent"),
    ...effectIntent
  }),
  strictObject({
    ...eventBase,
    type: Type.Literal("cancel_observed"),
    ...observedEffect
  }),
  strictObject({
    eventId: identifier(),
    expectedRevision: revision(),
    unitId: nullableIdentifier(),
    type: Type.Literal("effect_ambiguous"),
    effectId: effectIdentifier(),
    effectKind: EffectKindSchema,
    observationHash: Type.Optional(hash())
  })
]);
var runtimeEffectBase = {
  effectId: effectIdentifier(),
  unitId: nullableIdentifier(),
  idempotencyKey: idempotencyKey(),
  // The reducer derives this domain-separated digest from the typed params
  // below; adapters execute the typed params, never the opaque digest.
  paramsHash: hash(),
  schemaVersion: Type.Literal(SCHEMA_VERSION)
};
var RuntimeReservationRequestSchema = strictObject({
  id: identifier(),
  namespace: identifier(),
  resource: identifier()
});
var WorkerBindingSchema = strictObject({
  branchRef: identifier(),
  worktreePath: text(),
  requestedModel: text(),
  promptHash: hash()
});
var CandidateBindingSchema = strictObject({
  baseOid: oid(),
  headOid: oid(),
  treeOid: oid()
});
var RuntimeEffectSchema = Type.Union([
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("controller_acquire"),
    unitId: Type.Null(),
    params: strictObject({
      holder: controllerHolder(),
      controllerFencingToken: identifier(),
      requestedModel: text(),
      returnedModel: text(),
      promptHash: hash(),
      slotTransition: Type.Optional(SlotTransitionIntentSchema)
    })
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("reservation_acquire"),
    unitId: identifier(),
    params: strictObject({
      reservations: Type.Array(RuntimeReservationRequestSchema, {
        minItems: 1,
        maxItems: LIMITS.reservations,
        uniqueItems: true
      })
    })
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("branch_create"),
    unitId: identifier(),
    params: strictObject({ baseOid: oid(), branchRef: identifier() })
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("worktree_create"),
    unitId: identifier(),
    params: strictObject({ branchRef: identifier(), worktreePath: text() })
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("dispatch"),
    unitId: identifier(),
    params: WorkerBindingSchema
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("worker_collect"),
    unitId: identifier(),
    params: strictObject({ sessionId: identifier() })
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("candidate_collect"),
    unitId: identifier(),
    params: strictObject({ branchRef: identifier(), worktreePath: text() })
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("verify"),
    unitId: identifier(),
    params: strictObject({
      candidate: CandidateBindingSchema,
      commands: Type.Array(text(), { minItems: 1, maxItems: 32 })
    })
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("review_dispatch"),
    unitId: identifier(),
    params: strictObject({
      candidate: CandidateBindingSchema,
      requestedModel: text(),
      promptHash: hash()
    })
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("review_collect"),
    unitId: identifier(),
    params: strictObject({
      sessionId: identifier(),
      candidate: CandidateBindingSchema
    })
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("publish"),
    unitId: identifier(),
    params: strictObject({
      branchRef: identifier(),
      candidate: CandidateBindingSchema,
      authorityProfile: AuthorityProfileSchema,
      completionBoundary: CompletionBoundarySchema
    })
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("integrate"),
    unitId: identifier(),
    params: strictObject({
      integrationBranch: identifier(),
      integrationProfile: IntegrationProfileSchema,
      completionBoundary: CompletionBoundarySchema,
      controllerFencingToken: identifier(),
      candidate: CandidateBindingSchema
    })
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("reservation_release"),
    unitId: identifier(),
    params: strictObject({
      reservationIds: Type.Array(identifier(), {
        maxItems: LIMITS.reservations,
        uniqueItems: true
      })
    })
  }),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("repair"),
    unitId: identifier(),
    params: strictObject({
      ...WorkerBindingSchema.properties,
      repairBaseOid: oid(),
      repairHeadOid: Type.Optional(oid()),
      repairTreeOid: Type.Optional(oid())
    })
  }),
  ...["failure", "timeout", "park", "cancel"].map(
    (kind) => strictObject({
      ...runtimeEffectBase,
      kind: Type.Literal(kind),
      unitId: identifier(),
      params: Type.Union([
        strictObject({ role: Type.Literal("none") }),
        strictObject({ role: Type.Literal("worker"), sessionId: identifier() }),
        strictObject({
          role: Type.Literal("reviewer"),
          sessionId: identifier()
        })
      ])
    })
  ),
  strictObject({
    ...runtimeEffectBase,
    kind: Type.Literal("controller_release"),
    unitId: Type.Null(),
    params: strictObject({
      holder: controllerHolder(),
      controllerFencingToken: identifier(),
      slotTransition: Type.Optional(SlotTransitionIntentSchema)
    })
  })
]);
var RepositoryRunEnvelopeSchema = strictObject({
  schema: Type.Literal("sce.repository-run"),
  version: Type.Literal(SCHEMA_VERSION),
  payload: RepositoryRunSchema
});
var ProtocolEventEnvelopeSchema = strictObject({
  schema: Type.Literal("sce.protocol-event"),
  version: Type.Literal(SCHEMA_VERSION),
  payload: ProtocolEventSchema
});
var JudgmentEnvelopeSchema = strictObject({
  schema: Type.Literal("sce.judgment"),
  version: Type.Literal(SCHEMA_VERSION),
  payload: JudgmentSchema
});
var ajv = new import_ajv.Ajv({
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
  strict: true
});
ajv.addKeyword({
  keyword: "maxUtf8Bytes",
  type: "string",
  schemaType: "number",
  validate: (limit, value) => utf8.encode(value).byteLength <= limit,
  errors: false
});
function validate(schema, input) {
  const validator = ajv.compile(schema);
  if (validator(input)) return { ok: true, value: input, errors: [] };
  return { ok: false, errors: (validator.errors ?? []).map(formatError) };
}
function formatError(error) {
  return `${error.instancePath || "/"} ${error.message ?? "is invalid"}`;
}

// src/protocol/reducer.ts
import { deflateRawSync, inflateRawSync } from "node:zlib";

// src/protocol/canonical.ts
var preserveStrings = () => "exact";
function canonicalJson(value, stringPolicy = preserveStrings) {
  return canonical(value, stringPolicy, []);
}
function canonical(value, stringPolicy, path2) {
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("canonical JSON does not permit non-finite numbers");
    return JSON.stringify(value);
  }
  if (typeof value === "string")
    return JSON.stringify(normalizeString(value, stringPolicy(path2, "value")));
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index))
        throw new TypeError("canonical JSON rejects sparse arrays");
    }
    return `[${value.map((item, index) => canonical(item, stringPolicy, [...path2, index])).join(",")}]`;
  }
  if (typeof value !== "object")
    throw new TypeError("canonical JSON only permits JSON values");
  const object5 = value;
  const entries = Object.keys(object5).map((key) => ({
    key,
    normalizedKey: normalizeString(key, stringPolicy([...path2, key], "key"))
  }));
  entries.sort(
    (left, right) => left.normalizedKey < right.normalizedKey ? -1 : left.normalizedKey > right.normalizedKey ? 1 : 0
  );
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1].normalizedKey === entries[index].normalizedKey)
      throw new TypeError(
        "canonical JSON rejects duplicate normalized object keys"
      );
  }
  return `{${entries.map(
    ({ key, normalizedKey }) => `${JSON.stringify(normalizedKey)}:${canonical(
      object5[key],
      stringPolicy,
      [...path2, key]
    )}`
  ).join(",")}}`;
}
function normalizeString(value, normalization) {
  if (normalization !== "exact" && normalization !== "nfc")
    throw new TypeError(
      "canonical JSON string policy must return exact or nfc"
    );
  return validString(normalization === "nfc" ? value.normalize("NFC") : value);
}
function validString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 55296 && code <= 56319) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 56320 && next <= 57343))
        throw new TypeError(
          "canonical JSON rejects unpaired surrogate code units"
        );
      index += 1;
    } else if (code >= 56320 && code <= 57343) {
      throw new TypeError(
        "canonical JSON rejects unpaired surrogate code units"
      );
    }
  }
  return value;
}

// src/protocol/evidence.ts
import { createHash } from "node:crypto";
function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// src/protocol/guards.ts
var TERMINAL_INTENT_STATES = /* @__PURE__ */ new Set([
  "planned",
  "resources_reserved",
  "branch_observed",
  "worktree_observed",
  "dispatched",
  "collected",
  "candidate_committed",
  "qualified",
  "reviewer_dispatched",
  "approved",
  "published",
  "repair_required"
]);
function canEnterTerminalIntent(state) {
  return TERMINAL_INTENT_STATES.has(state);
}

// src/protocol/reducer.ts
var utf82 = new TextEncoder();
function reduce(stateInput, eventInput) {
  return reduceInternal(stateInput, eventInput);
}
function reduceInternal(stateInput, eventInput, reconcilingBlockedObservation = false) {
  const parsedState = validate(RepositoryRunSchema, stateInput);
  if (!parsedState.ok || parsedState.value === void 0)
    return reject("invalid_state", parsedState.errors.join("; "));
  const parsedEvent = validate(ProtocolEventSchema, eventInput);
  if (!parsedEvent.ok || parsedEvent.value === void 0)
    return reject("invalid_event", parsedEvent.errors.join("; "));
  const state = parsedState.value;
  const event = parsedEvent.value;
  if (!reconcilingBlockedObservation) {
    const errors = runInvariantErrors(state);
    if (errors.length) return reject("invariant", errors.join("; "));
  }
  if (event.expectedRevision !== state.revision)
    return reject(
      "stale_revision",
      "expected aggregate revision does not match"
    );
  if (state.processedEventIds.includes(event.eventId))
    return reject("duplicate_event", "event id has already been applied");
  if ("idempotencyKey" in event && state.processedIdempotencyKeys.includes(event.idempotencyKey))
    return reject(
      "duplicate_event",
      "idempotency key has already been applied"
    );
  const declaredIntentKind = effectKindForIntent(event.type);
  if (declaredIntentKind !== void 0 && "idempotencyKey" in event && event.idempotencyKey !== deriveIdempotencyKey(
    state,
    event.expectedRevision,
    "unitId" in event ? event.unitId : null,
    declaredIntentKind
  ))
    return reject(
      "invalid_event",
      "idempotency key is not deterministic for this run, revision, unit, and effect"
    );
  if (event.type === "controller_acquire_intent" || event.type === "controller_acquired" || event.type === "controller_release_intent" || event.type === "controller_released")
    return reduceController(state, event);
  if (state.state === "released")
    return reject("illegal_transition", `aggregate is ${state.state}`);
  if (event.type === "effect_ambiguous") {
    const blocked = markEffectAmbiguous(state, event);
    return blocked === void 0 ? badObservation() : commit(blocked, event, []);
  }
  if (state.state === "blocked" && !reconcilingBlockedObservation) {
    const recovered = prepareBlockedUnitObservation(state, event);
    if (recovered === void 0)
      return reject("illegal_transition", "aggregate is blocked");
    return reduceInternal(recovered, event, true);
  }
  if (state.controller.state !== "acquired")
    return reject(
      "illegal_transition",
      "controller ownership has not been acquired"
    );
  if (event.unitId === null)
    return reject("illegal_transition", "unit event requires a unit id");
  const unit = state.units[event.unitId];
  if (unit === void 0) return reject("illegal_transition", "unknown unit");
  if (!state.wave.unitIds.includes(unit.id))
    return reject("illegal_transition", "unit is not in the current wave");
  const emittedKind = effectKindForIntent(event.type);
  if (emittedKind !== void 0 && hasUnresolvedUnitEffect(state, unit.id))
    return reject(
      "illegal_transition",
      "unit already has an unresolved intended or ambiguous effect"
    );
  if (emittedKind !== void 0 && !effectAllowed(state, emittedKind))
    return reject(
      "illegal_transition",
      `authority profile forbids ${emittedKind}`
    );
  let result2;
  switch (event.type) {
    case "reservation_intent":
      if (unit.state !== "planned") return illegal(unit, event.type);
      if (event.reservations.some((r) => state.reservations[r.id] !== void 0))
        return reject("invariant", "reservation id is already owned");
      if (new Set(event.reservations.map((r) => `${r.namespace}/${r.resource}`)).size !== event.reservations.length)
        return reject("invariant", "reservation request collides with itself");
      if (Object.values(state.reservations).some(
        (r) => r.state !== "released" && event.reservations.some(
          (next) => next.namespace === r.namespace && next.resource === r.resource
        )
      ))
        return reject("invariant", "reservation resource is already occupied");
      result2 = intent(
        state,
        unit,
        "reservation_intent",
        event,
        "reservation_acquire",
        {
          reservations: {
            ...state.reservations,
            ...Object.fromEntries(
              event.reservations.map((r) => [
                r.id,
                { ...r, unitId: unit.id, state: "intended" }
              ])
            )
          },
          units: replaceUnit(state, {
            ...unit,
            reservationIds: event.reservations.map((r) => r.id)
          })
        }
      );
      break;
    case "reservation_observed":
      if (unit.state !== "reservation_intent") return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "reservation_acquire"))
        return badObservation();
      result2 = observe(
        state,
        unit,
        "resources_reserved",
        event,
        {},
        {
          reservations: updateReservations(
            state,
            unit.id,
            "reserved",
            event.effectId
          )
        }
      );
      break;
    case "branch_intent":
      if (unit.state !== "resources_reserved") return illegal(unit, event.type);
      result2 = intent(state, unit, "branch_intent", event, "branch_create", {
        units: replaceUnit(state, { ...unit, branchRef: event.branchRef })
      });
      break;
    case "branch_observed":
      if (unit.state !== "branch_intent" || unit.branchRef !== event.branchRef)
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "branch_create"))
        return badObservation();
      result2 = observe(state, unit, "branch_observed", event);
      break;
    case "worktree_intent":
      if (unit.state !== "branch_observed") return illegal(unit, event.type);
      result2 = intent(
        state,
        unit,
        "worktree_intent",
        event,
        "worktree_create",
        {
          units: replaceUnit(state, {
            ...unit,
            worktreePath: event.worktreePath
          })
        }
      );
      break;
    case "worktree_observed":
      if (unit.state !== "worktree_intent" || unit.worktreePath !== event.worktreePath)
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "worktree_create"))
        return badObservation();
      result2 = observe(state, unit, "worktree_observed", event);
      break;
    case "dispatch_intent":
      if (unit.state !== "worktree_observed") return illegal(unit, event.type);
      if (state.activeModifyingUnitIds.length >= 3)
        return reject("invariant", "all three modifying slots are occupied");
      result2 = modifyingIntent(
        state,
        unit,
        "dispatch_intent",
        event,
        "dispatch",
        {
          workerRequestedModel: event.requestedModel,
          workerPromptHash: event.promptHash
        }
      );
      break;
    case "dispatch_observed":
      const dispatchedSession = freshSessionUpdate(
        state,
        event.sessionId,
        unit,
        "worker"
      );
      if (unit.state !== "dispatch_intent" || event.requestedModel !== unit.workerRequestedModel || event.promptHash !== unit.workerPromptHash || dispatchedSession === void 0)
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "dispatch"))
        return badObservation();
      result2 = observe(
        state,
        unit,
        "dispatched",
        event,
        workerSession(event),
        dispatchedSession
      );
      break;
    case "collect_intent":
      if (unit.state !== "dispatched") return illegal(unit, event.type);
      result2 = intent(state, unit, "collect_intent", event, "worker_collect");
      break;
    case "worker_collected":
      if (unit.state !== "collect_intent") return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "worker_collect"))
        return badObservation();
      result2 = event.workerResult.status === "failed" ? observe(
        state,
        unit,
        "failed",
        event,
        {
          workerResult: event.workerResult,
          repairContext: {
            baseOid: unit.baseOid,
            responseHash: event.observationHash,
            rationale: event.workerResult.summary,
            findings: [
              {
                id: "worker-failed",
                severity: "blocking",
                detail: event.workerResult.summary
              }
            ]
          }
        },
        clearUnitOwners(state, unit.id)
      ) : event.workerResult.status === "needs_repair" ? observe(
        state,
        unit,
        "repair_required",
        event,
        {
          workerResult: event.workerResult,
          repairContext: {
            baseOid: unit.baseOid,
            responseHash: event.observationHash,
            rationale: event.workerResult.summary,
            findings: [
              {
                id: "worker-needs-repair",
                severity: "blocking",
                detail: event.workerResult.summary
              }
            ]
          }
        },
        clearUnitOwners(state, unit.id)
      ) : observe(
        state,
        unit,
        "collected",
        event,
        { workerResult: event.workerResult },
        {
          activeModifyingUnitIds: state.activeModifyingUnitIds.filter(
            (id) => id !== unit.id
          )
        }
      );
      if (event.workerResult.status === "failed")
        result2 = persistTerminalClosureEvidence(result2, unit.id);
      break;
    case "candidate_intent":
      if (unit.state !== "collected") return illegal(unit, event.type);
      result2 = intent(
        state,
        unit,
        "candidate_intent",
        event,
        "candidate_collect"
      );
      break;
    case "candidate_observed":
      if (unit.state !== "candidate_intent") return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "candidate_collect"))
        return badObservation();
      result2 = observe(
        state,
        unit,
        "candidate_committed",
        event,
        {
          candidateHead: event.headOid,
          candidateTree: event.treeOid
        },
        { qualificationQueue: insertSorted(state.qualificationQueue, unit.id) }
      );
      break;
    case "verification_intent":
      if (unit.state !== "candidate_committed")
        return illegal(unit, event.type);
      if (state.qualificationOwnerUnitId !== void 0 && state.qualificationOwnerUnitId !== unit.id)
        return reject(
          "invariant",
          "final qualification is owned by another unit"
        );
      if (state.qualificationQueue[0] !== unit.id)
        return reject(
          "invariant",
          "unit is not first in deterministic qualification queue"
        );
      result2 = intent(state, unit, "verification_intent", event, "verify", {
        qualificationOwnerUnitId: unit.id,
        units: replaceUnit(state, {
          ...unit,
          verificationCommands: [...event.commands]
        })
      });
      break;
    case "verification_observed":
      if (unit.state !== "verification_intent" || state.qualificationOwnerUnitId !== unit.id || unit.baseOid !== event.baseOid || unit.candidateHead !== event.headOid || unit.candidateTree !== event.treeOid)
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "verify"))
        return badObservation();
      result2 = observe(state, unit, "qualified", event, {
        verificationBaseOid: unit.baseOid,
        verificationHeadOid: event.headOid,
        verificationTree: event.treeOid,
        verificationEvidenceHash: event.observationHash
      });
      break;
    case "reviewer_dispatch_intent":
      if (unit.state !== "qualified" || state.qualificationOwnerUnitId !== unit.id || state.currentReviewerUnitId !== void 0)
        return illegal(unit, event.type);
      result2 = intent(
        state,
        unit,
        "reviewer_dispatch_intent",
        event,
        "review_dispatch",
        {
          currentReviewerUnitId: unit.id,
          units: replaceUnit(state, {
            ...unit,
            reviewerRequestedModel: event.requestedModel,
            reviewPromptHash: event.promptHash
          })
        }
      );
      break;
    case "reviewer_observed":
      const reviewerSessionUpdate = freshSessionUpdate(
        state,
        event.sessionId,
        unit,
        "reviewer"
      );
      if (unit.state !== "reviewer_dispatch_intent" || state.currentReviewerUnitId !== unit.id || event.requestedModel !== unit.reviewerRequestedModel || event.promptHash !== unit.reviewPromptHash || reviewerSessionUpdate === void 0)
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "review_dispatch"))
        return badObservation();
      result2 = observe(
        state,
        unit,
        "reviewer_dispatched",
        event,
        reviewerSession(event),
        reviewerSessionUpdate
      );
      break;
    case "review_collect_intent":
      if (unit.state !== "reviewer_dispatched" || state.currentReviewerUnitId !== unit.id)
        return illegal(unit, event.type);
      result2 = intent(
        state,
        unit,
        "review_collect_intent",
        event,
        "review_collect"
      );
      break;
    case "review_collected": {
      if (unit.state !== "review_collect_intent" || state.currentReviewerUnitId !== unit.id)
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "review_collect"))
        return badObservation();
      const judgmentError = reviewJudgmentError(
        unit,
        event.judgment,
        state.revision
      );
      if (judgmentError !== void 0)
        return reject("illegal_transition", judgmentError);
      if (event.judgment.decision === "request_changes") {
        if (!event.judgment.findings.some(
          (finding) => finding.severity === "blocking"
        ))
          return reject(
            "illegal_transition",
            "request_changes requires a blocking finding"
          );
        result2 = observe(
          state,
          unit,
          "repair_required",
          event,
          {
            repairContext: {
              baseOid: event.judgment.baseOid,
              headOid: event.judgment.headOid,
              treeOid: event.judgment.treeOid,
              responseHash: event.judgment.responseHash,
              rationale: event.judgment.rationale,
              findings: event.judgment.findings
            }
          },
          clearUnitOwners(state, unit.id)
        );
      } else {
        result2 = observe(
          state,
          unit,
          "approved",
          event,
          {
            reviewBaseOid: event.judgment.baseOid,
            reviewHeadOid: event.judgment.headOid,
            reviewTree: event.judgment.treeOid,
            approvalResponseHash: event.judgment.responseHash
          },
          {
            currentReviewerUnitId: null,
            integrationQueue: insertSorted(state.integrationQueue, unit.id)
          }
        );
      }
      break;
    }
    case "publish_intent":
      if (!isCurrentApproval(unit) || state.qualificationOwnerUnitId !== unit.id || publicationKind(state) === void 0)
        return illegal(unit, event.type);
      result2 = intent(state, unit, "publish_intent", event, "publish");
      break;
    case "publish_observed":
      if (unit.state !== "publish_intent" || (event.publication.kind === "push_branch" ? unit.candidateHead !== event.publication.remoteHeadOid : unit.candidateHead !== event.publication.pullRequest.remoteHeadOid))
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "publish"))
        return badObservation();
      if (publicationKind(state) === "open_pr") {
        if (event.publication.kind !== "open_pr" || event.publication.pullRequest.baseRef !== state.integrationBranch || event.publication.pullRequest.baseOid !== unit.reviewBaseOid)
          return reject(
            "illegal_transition",
            "open-pr publication lacks the reviewed open pull-request identity and base"
          );
      } else if (event.publication.kind !== "push_branch")
        return reject(
          "illegal_transition",
          "branch publication must record a push-branch readback"
        );
      const publishedHeadOid = event.publication.kind === "open_pr" ? event.publication.pullRequest.remoteHeadOid : event.publication.remoteHeadOid;
      result2 = observe(
        state,
        unit,
        isPublicationHandoff(state) ? "handoff" : "published",
        event,
        {
          publishedHeadOid,
          ...event.publication.kind === "open_pr" ? { openPullRequest: event.publication.pullRequest } : {}
        },
        isPublicationHandoff(state) ? clearUnitOwners(state, unit.id) : {}
      );
      if (isPublicationHandoff(state))
        result2 = persistTerminalClosureEvidence(result2, unit.id);
      break;
    case "integrate_intent":
      if (!canIntegrateFrom(state, unit) || !hasCurrentApproval(unit) || state.qualificationOwnerUnitId !== unit.id || state.integrationOwnerUnitId !== void 0 && state.integrationOwnerUnitId !== unit.id)
        return illegal(unit, event.type);
      if (state.integrationQueue[0] !== unit.id)
        return reject(
          "invariant",
          "unit is not first in deterministic integration queue"
        );
      result2 = intent(state, unit, "integrate_intent", event, "integrate", {
        integrationOwnerUnitId: unit.id
      });
      break;
    case "integrate_observed":
      if (unit.state !== "integrate_intent" || state.integrationOwnerUnitId !== unit.id || event.controllerFencingToken !== state.controllerFencingToken || event.baseOid !== unit.reviewBaseOid || event.headOid !== unit.reviewHeadOid || event.treeOid !== unit.reviewTree)
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "integrate"))
        return badObservation();
      result2 = observe(
        state,
        unit,
        "landed",
        event,
        { landedOid: event.integrationOid },
        {
          qualificationOwnerUnitId: null,
          integrationOwnerUnitId: null,
          qualificationQueue: state.qualificationQueue.filter(
            (id) => id !== unit.id
          ),
          integrationQueue: state.integrationQueue.filter(
            (id) => id !== unit.id
          )
        }
      );
      result2 = persistTerminalClosureEvidence(result2, unit.id);
      break;
    case "reservation_release_intent":
      if (![
        "landed",
        "handoff",
        "cancelled",
        "parked",
        "failed",
        "timed_out"
      ].includes(unit.state))
        return illegal(unit, event.type);
      result2 = intent(
        state,
        unit,
        "reservation_release_intent",
        event,
        "reservation_release",
        { reservations: updateReservations(state, unit.id, "release_intent") }
      );
      result2 = {
        ...result2,
        state: {
          ...result2.state,
          closedUnitEvidence: updateClosureReleaseEvidence(
            result2.state,
            unit.id
          )
        }
      };
      break;
    case "reservation_released":
      if (unit.state !== "reservation_release_intent")
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "reservation_release"))
        return badObservation();
      result2 = observe(
        state,
        unit,
        "closed",
        event,
        {},
        {
          reservations: updateReservations(
            state,
            unit.id,
            "released",
            event.effectId
          )
        }
      );
      result2 = {
        ...result2,
        state: closeUnitAfterRelease(result2.state, unit.id)
      };
      break;
    case "repair_intent":
      if (unit.state !== "repair_required" && unit.state !== "failed" && unit.state !== "timed_out")
        return illegal(unit, event.type);
      if (!validRepairJudgment(state, unit, event.judgment, state.revision))
        return reject(
          "illegal_transition",
          "repair judgment is not bound to this unit and revision"
        );
      if (unit.branchRef === void 0 || unit.worktreePath === void 0)
        return reject(
          "illegal_transition",
          "repair requires the retained branch and worktree bindings"
        );
      if (unit.repairCount >= 16 || state.activeModifyingUnitIds.length >= 3)
        return reject("invariant", "all three modifying slots are occupied");
      result2 = modifyingIntent(state, unit, "repair_intent", event, "repair", {
        workerRequestedModel: event.requestedModel,
        workerPromptHash: event.promptHash
      });
      result2 = {
        ...result2,
        state: removeClosureEvidence(result2.state, unit.id)
      };
      break;
    case "repair_observed":
      const repairedSession = freshSessionUpdate(
        state,
        event.sessionId,
        unit,
        "worker"
      );
      if (unit.state !== "repair_intent" || event.requestedModel !== unit.workerRequestedModel || event.promptHash !== unit.workerPromptHash || repairedSession === void 0)
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "repair"))
        return badObservation();
      result2 = observe(
        state,
        unit,
        "dispatched",
        event,
        {
          ...workerSession(event),
          repairCount: unit.repairCount + 1
        },
        repairedSession
      );
      break;
    case "failure_intent":
      if (!canEnterTerminalIntent(unit.state)) return illegal(unit, event.type);
      result2 = terminalIntent(state, unit, "failure_intent", event, "failure");
      break;
    case "failure_observed":
      if (unit.state !== "failure_intent" || !matchesIntended(state, event, unit.id, "failure"))
        return illegal(unit, event.type);
      result2 = observe(
        state,
        unit,
        "failed",
        event,
        failureRepairContext(unit, event.observationHash, "failure observed"),
        clearUnitOwners(state, unit.id)
      );
      result2 = persistTerminalClosureEvidence(result2, unit.id);
      break;
    case "timeout_intent":
      if (!canEnterTerminalIntent(unit.state)) return illegal(unit, event.type);
      result2 = terminalIntent(state, unit, "timeout_intent", event, "timeout");
      break;
    case "timeout_observed":
      if (unit.state !== "timeout_intent" || !matchesIntended(state, event, unit.id, "timeout"))
        return illegal(unit, event.type);
      result2 = observe(
        state,
        unit,
        "timed_out",
        event,
        failureRepairContext(unit, event.observationHash, "timeout observed"),
        clearUnitOwners(state, unit.id)
      );
      result2 = persistTerminalClosureEvidence(result2, unit.id);
      break;
    case "park_intent":
      if (!canEnterTerminalIntent(unit.state)) return illegal(unit, event.type);
      result2 = terminalIntent(state, unit, "park_intent", event, "park");
      break;
    case "park_observed":
      if (unit.state !== "park_intent" || !matchesIntended(state, event, unit.id, "park"))
        return illegal(unit, event.type);
      result2 = observe(
        state,
        unit,
        "parked",
        event,
        {},
        clearUnitOwners(state, unit.id)
      );
      result2 = persistTerminalClosureEvidence(result2, unit.id);
      break;
    case "cancel_intent":
      if (!canEnterTerminalIntent(unit.state)) return illegal(unit, event.type);
      result2 = terminalIntent(state, unit, "cancel_intent", event, "cancel");
      break;
    case "cancel_observed":
      if (unit.state !== "cancel_intent" || !matchesIntended(state, event, unit.id, "cancel"))
        return illegal(unit, event.type);
      result2 = observe(
        state,
        unit,
        "cancelled",
        event,
        {},
        clearUnitOwners(state, unit.id)
      );
      result2 = persistTerminalClosureEvidence(result2, unit.id);
      break;
    default:
      return exhaustive(event);
  }
  return result2 === void 0 ? reject("illegal_transition", "event was not handled") : commit(result2.state, event, result2.effects);
}
function effectKindForIntent(type) {
  const kinds = {
    controller_acquire_intent: "controller_acquire",
    controller_release_intent: "controller_release",
    reservation_intent: "reservation_acquire",
    branch_intent: "branch_create",
    worktree_intent: "worktree_create",
    dispatch_intent: "dispatch",
    collect_intent: "worker_collect",
    candidate_intent: "candidate_collect",
    verification_intent: "verify",
    reviewer_dispatch_intent: "review_dispatch",
    review_collect_intent: "review_collect",
    publish_intent: "publish",
    integrate_intent: "integrate",
    reservation_release_intent: "reservation_release",
    repair_intent: "repair",
    failure_intent: "failure",
    timeout_intent: "timeout",
    park_intent: "park",
    cancel_intent: "cancel"
  };
  return kinds[type];
}
function deriveIdempotencyKey(state, expectedRevision, unitId, kind) {
  return `sce:${sha256(
    canonicalJson({
      domain: "sce.protocol.idempotency.v1",
      effectKind: kind,
      expectedRevision,
      incarnationId: state.controller.incarnationId,
      runId: state.controller.runId,
      unitId
    })
  )}`;
}
function deriveParamsHash(kind, params) {
  return sha256(
    canonicalJson({
      domain: "sce.protocol.effect-params.v1",
      effectKind: kind,
      params,
      schemaVersion: SCHEMA_VERSION
    })
  );
}
function rehydrateEffect(state, entry) {
  try {
    if (entry.intentCommitment !== deriveIntentCommitment(entry))
      return void 0;
    const params = runtimeEffectParams(
      state,
      entry.unitId,
      entry.kind,
      entry.slotTransition
    );
    if (deriveParamsHash(entry.kind, params) !== entry.paramsHash)
      return void 0;
    const effect2 = {
      effectId: entry.effectId,
      idempotencyKey: entry.idempotencyKey,
      kind: entry.kind,
      params,
      paramsHash: entry.paramsHash,
      schemaVersion: SCHEMA_VERSION,
      unitId: entry.unitId
    };
    const checked = validate(RuntimeEffectSchema, effect2);
    return checked.ok && checked.value !== void 0 ? checked.value : void 0;
  } catch {
    return void 0;
  }
}
function deriveIntentCommitment(entry) {
  return sha256(
    canonicalJson({
      domain: "sce.protocol.journal-intent.v1",
      effectId: entry.effectId,
      unitId: entry.unitId,
      idempotencyKey: entry.idempotencyKey,
      kind: entry.kind,
      intentRevision: entry.intentRevision,
      paramsHash: entry.paramsHash,
      ...entry.slotTransition === void 0 ? {} : { slotTransition: entry.slotTransition },
      schemaVersion: entry.schemaVersion
    })
  );
}
function journalEntryCommitment(entry) {
  return sha256(
    canonicalJson({
      domain: "sce.protocol.journal-entry.v1",
      intentCommitment: entry.intentCommitment,
      status: entry.status,
      ...entry.observationHash === void 0 ? {} : { observationHash: entry.observationHash }
    })
  );
}
function foldJournalCommitment(previous, entry) {
  return sha256(
    canonicalJson({
      domain: "sce.protocol.journal-chain.v1",
      previous,
      entry: journalEntryCommitment(entry)
    })
  );
}
function deriveJournalCommitment(checkpointCommitment, entries) {
  return entries.reduce(
    (commitment, entry) => foldJournalCommitment(commitment, entry),
    checkpointCommitment
  );
}
function deriveRepairContextHash(context) {
  return sha256(
    canonicalJson({
      domain: "sce.protocol.repair-context.v1",
      baseOid: context.baseOid,
      ...context.headOid === void 0 ? {} : { headOid: context.headOid },
      ...context.treeOid === void 0 ? {} : { treeOid: context.treeOid },
      responseHash: context.responseHash,
      rationale: context.rationale,
      findings: context.findings.map((finding) => ({
        id: finding.id,
        severity: finding.severity,
        detail: finding.detail
      }))
    })
  );
}
function repairJudgmentPromptContent(judgment) {
  return {
    schemaVersion: judgment.schemaVersion,
    role: judgment.role,
    kind: judgment.kind,
    unitId: judgment.unitId,
    sessionId: judgment.sessionId,
    requestedModel: judgment.requestedModel,
    returnedModel: judgment.returnedModel,
    aggregateRevision: judgment.aggregateRevision,
    factOid: judgment.factOid,
    currentEvidenceHash: judgment.currentEvidenceHash,
    findingsContextHash: judgment.findingsContextHash
  };
}
function repairJudgmentResponseContent(judgment) {
  return {
    ...repairJudgmentPromptContent(judgment),
    promptHash: judgment.promptHash,
    rationale: judgment.rationale,
    decision: judgment.decision
  };
}
function repairJudgmentAggregatePacket(state) {
  const { closedUnitEvidence: _compressedClosedEvidence, ...aggregate } = state;
  return aggregate;
}
function deriveRepairJudgmentResponseHash(judgment) {
  return sha256(
    canonicalJson({
      domain: "sce.protocol.repair-judgment-response.v1",
      judgment: repairJudgmentResponseContent(judgment)
    })
  );
}
function deriveRepairJudgmentPromptHash(state, unit, judgment) {
  return sha256(
    canonicalJson({
      domain: "sce.protocol.repair-judgment-prompt.v1",
      aggregate: repairJudgmentAggregatePacket(state),
      controller: state.controller,
      unit: {
        id: unit.id,
        ordinal: unit.ordinal,
        revision: unit.revision,
        state: unit.state,
        baseOid: unit.baseOid,
        ...unit.branchRef === void 0 ? {} : { branchRef: unit.branchRef },
        ...unit.worktreePath === void 0 ? {} : { worktreePath: unit.worktreePath },
        ...unit.candidateHead === void 0 ? {} : { candidateHead: unit.candidateHead },
        ...unit.candidateTree === void 0 ? {} : { candidateTree: unit.candidateTree },
        repairCount: unit.repairCount,
        ...unit.repairContext === void 0 ? {} : { repairContext: unit.repairContext }
      },
      judgment: repairJudgmentPromptContent(judgment)
    })
  );
}
function effectAllowed(state, kind) {
  if (kind === "publish")
    return state.completionBoundary === "branch-handoff" && state.authorityProfile !== "local-change-only" || state.completionBoundary === "pr-handoff" && ["open-pr", "integrate"].includes(state.authorityProfile) || state.completionBoundary === "remote-integration" && state.authorityProfile === "integrate";
  if (kind !== "integrate") return true;
  return state.completionBoundary === "local-integration" || state.completionBoundary === "remote-integration" && state.authorityProfile === "integrate";
}
function isPublicationHandoff(state) {
  return state.completionBoundary === "branch-handoff" || state.completionBoundary === "pr-handoff";
}
function canIntegrateFrom(state, unit) {
  return integrationIsRequested(state) && (state.completionBoundary === "local-integration" ? unit.state === "approved" : unit.state === "published");
}
function integrationIsRequested(state) {
  return state.completionBoundary === "local-integration" || state.completionBoundary === "remote-integration";
}
function completionConfigurationError(state) {
  switch (state.completionBoundary) {
    case "local-integration":
      return state.integrationProfile === "local-ff" ? void 0 : "local integration requires the local-ff integration profile";
    case "branch-handoff":
      return state.integrationProfile === "none" && state.authorityProfile !== "local-change-only" ? void 0 : "branch handoff requires push-capable authority and integration profile none";
    case "pr-handoff":
      return state.integrationProfile === "none" && ["open-pr", "integrate"].includes(state.authorityProfile) ? void 0 : "pr handoff requires open-pr-capable authority and integration profile none";
    case "remote-integration":
      return state.authorityProfile === "integrate" && state.integrationProfile === "remote-ff" ? void 0 : "remote integration requires integrate authority and a remote integration profile";
  }
}
function publicationKind(state) {
  if (state.completionBoundary === "local-integration") return void 0;
  if (state.completionBoundary === "pr-handoff") return "open_pr";
  return "push_branch";
}
function freshSessionUpdate(state, sessionId, unit, role) {
  if (state.usedSessionCount >= LIMITS.sessionHistory || controllerIdentityMatches(state, sessionId) || Object.values(state.units).some(
    (unit2) => unit2.workerSessionId === sessionId || unit2.reviewerSessionId === sessionId
  ))
    return void 0;
  const lineage = decodeSessionLineage(state.sessionLineage);
  if (lineage === void 0) return void 0;
  const fingerprint = sessionFingerprint(sessionId);
  if (lineage.slots.some((entry) => entry?.equals(fingerprint)))
    return void 0;
  const start = sessionRoleSlot(unit.ordinal, role);
  const slot = Array.from(
    { length: sessionsPerRole() },
    (_, offset) => start + offset
  ).find((index) => lineage.slots[index] === void 0);
  if (slot === void 0) return void 0;
  const next = [...lineage.slots];
  next[slot] = fingerprint;
  const sessionLineage = encodeSessionLineage(next);
  return {
    sessionLineage,
    sessionLineageRoot: deriveSessionLineageRoot(
      sessionLineage,
      state.usedSessionCount + 1
    ),
    usedSessionCount: state.usedSessionCount + 1
  };
}
function controllerIdentityMatches(state, sessionId) {
  return [
    state.controller.runId,
    state.controller.incarnationId,
    state.controller.holder
  ].includes(sessionId);
}
function deriveSessionFingerprint(sessionId) {
  return sha256(
    canonicalJson({ domain: "sce.protocol.session-lineage.v1", sessionId })
  );
}
function sessionFingerprint(sessionId) {
  return Buffer.from(deriveSessionFingerprint(sessionId), "hex");
}
function sessionsPerRole() {
  return 17;
}
function sessionRoleSlot(ordinal, role) {
  return (ordinal * 2 + (role === "reviewer" ? 1 : 0)) * sessionsPerRole();
}
function sessionBitmapBytes(slotCount) {
  return Math.ceil(slotCount / 8);
}
function sessionRawBytes(slotCount) {
  return sessionBitmapBytes(slotCount) + slotCount * LIMITS.sessionFingerprintBytes;
}
function sessionSlotsForRawLength(length) {
  for (let bitmapBytes = 1; bitmapBytes <= sessionBitmapBytes(LIMITS.sessionHistory); bitmapBytes += 1) {
    const slotCount = (length - bitmapBytes) / LIMITS.sessionFingerprintBytes;
    if (Number.isInteger(slotCount) && slotCount > 0 && slotCount <= LIMITS.sessionHistory && sessionBitmapBytes(slotCount) === bitmapBytes)
      return slotCount;
  }
  return void 0;
}
function encodeSessionLineage(slots) {
  let last = slots.length - 1;
  while (last >= 0 && slots[last] === void 0) last -= 1;
  if (last < 0) return "";
  const slotCount = last + 1;
  const bitmapBytes = sessionBitmapBytes(slotCount);
  const raw = Buffer.alloc(sessionRawBytes(slotCount));
  for (let index = 0; index < slotCount; index += 1) {
    const fingerprint = slots[index];
    if (fingerprint === void 0) continue;
    if (fingerprint.length !== LIMITS.sessionFingerprintBytes)
      throw new Error("invalid session fingerprint length");
    raw[Math.floor(index / 8)] |= 1 << index % 8;
    fingerprint.copy(raw, bitmapBytes + index * LIMITS.sessionFingerprintBytes);
  }
  return raw.toString("base64");
}
function decodeSessionLineage(encoded) {
  if (encoded === "") return { slots: [], count: 0 };
  let raw;
  try {
    raw = Buffer.from(encoded, "base64");
  } catch {
    return void 0;
  }
  const slotCount = sessionSlotsForRawLength(raw.length);
  if (raw.toString("base64") !== encoded || slotCount === void 0)
    return void 0;
  const bitmapBytes = sessionBitmapBytes(slotCount);
  const slots = Array.from(
    { length: slotCount },
    () => void 0
  );
  const seen = /* @__PURE__ */ new Set();
  let count = 0;
  for (let index = 0; index < slotCount; index += 1) {
    const occupied = (raw[Math.floor(index / 8)] & 1 << index % 8) !== 0;
    const fingerprint = raw.subarray(
      bitmapBytes + index * LIMITS.sessionFingerprintBytes,
      bitmapBytes + (index + 1) * LIMITS.sessionFingerprintBytes
    );
    if (!occupied) {
      if (!fingerprint.every((byte) => byte === 0)) return void 0;
      continue;
    }
    const key = fingerprint.toString("hex");
    if (seen.has(key)) return void 0;
    seen.add(key);
    slots[index] = fingerprint;
    count += 1;
  }
  const unusedBitmapBits = slotCount % 8;
  if (unusedBitmapBits !== 0 && (raw[bitmapBytes - 1] & ~((1 << unusedBitmapBits) - 1)) !== 0)
    return void 0;
  if (slots.at(-1) === void 0) return void 0;
  return { slots, count };
}
function deriveSessionLineageRoot(sessionLineage, usedSessionCount) {
  if (sessionLineage === "" && usedSessionCount === 0) return "0".repeat(64);
  return sha256(
    canonicalJson({
      domain: "sce.protocol.session-lineage-root.v1",
      sessionLineage,
      usedSessionCount
    })
  );
}
function hasUnresolvedUnitEffect(state, unitId) {
  return state.effectJournal.some(
    (effect2) => effect2.unitId === unitId && (effect2.status === "intended" || effect2.status === "ambiguous")
  );
}
function intentStateForEffect(kind) {
  const states = {
    reservation_acquire: "reservation_intent",
    branch_create: "branch_intent",
    worktree_create: "worktree_intent",
    dispatch: "dispatch_intent",
    worker_collect: "collect_intent",
    candidate_collect: "candidate_intent",
    verify: "verification_intent",
    review_dispatch: "reviewer_dispatch_intent",
    review_collect: "review_collect_intent",
    publish: "publish_intent",
    integrate: "integrate_intent",
    reservation_release: "reservation_release_intent",
    repair: "repair_intent",
    failure: "failure_intent",
    timeout: "timeout_intent",
    park: "park_intent",
    cancel: "cancel_intent"
  };
  return states[kind];
}
function effectMatchesObservation(type, kind) {
  const observations = {
    reservation_acquire: "reservation_observed",
    branch_create: "branch_observed",
    worktree_create: "worktree_observed",
    dispatch: "dispatch_observed",
    worker_collect: "worker_collected",
    candidate_collect: "candidate_observed",
    verify: "verification_observed",
    review_dispatch: "reviewer_observed",
    review_collect: "review_collected",
    publish: "publish_observed",
    integrate: "integrate_observed",
    reservation_release: "reservation_released",
    repair: "repair_observed",
    failure: "failure_observed",
    timeout: "timeout_observed",
    park: "park_observed",
    cancel: "cancel_observed"
  };
  return observations[kind] === type;
}
function prepareBlockedUnitObservation(state, event) {
  if (!("unitId" in event) || event.unitId === null || event.type === "effect_ambiguous" || !("effectId" in event) || !("effectKind" in event))
    return void 0;
  const unit = state.units[event.unitId];
  const entry = state.effectJournal.find(
    (effect2) => effect2.effectId === event.effectId && effect2.unitId === event.unitId && effect2.kind === event.effectKind && (effect2.status === "intended" || effect2.status === "ambiguous")
  );
  const recoveredState = intentStateForEffect(event.effectKind);
  if (unit === void 0 || entry === void 0 || recoveredState === void 0 || !effectMatchesObservation(event.type, event.effectKind))
    return void 0;
  if (entry.status === "intended")
    return unit.state === recoveredState ? state : void 0;
  if (unit.state !== "blocked") return void 0;
  return {
    ...state,
    units: replaceUnit(state, { ...unit, state: recoveredState }),
    effectJournal: state.effectJournal.map(
      (effect2) => effect2.effectId === entry.effectId ? restoreIntended(effect2) : effect2
    )
  };
}
function restoreIntended(entry) {
  const { observationHash: _ambiguousObservation, ...intended } = entry;
  return { ...intended, status: "intended" };
}
function markEffectAmbiguous(state, event) {
  const entry = state.effectJournal.find(
    (candidate) => candidate.effectId === event.effectId && candidate.unitId === event.unitId && candidate.kind === event.effectKind && candidate.status === "intended"
  );
  if (entry === void 0) return void 0;
  if (entry.unitId === null) {
    const expectedControllerState = entry.kind === "controller_acquire" ? "acquire_intent" : entry.kind === "controller_release" ? "release_intent" : void 0;
    if (expectedControllerState !== state.controller.state) return void 0;
  } else {
    const unit = state.units[entry.unitId];
    const expectedUnitState = intentStateForEffect(entry.kind);
    if (unit === void 0 || unit.state !== expectedUnitState)
      return void 0;
  }
  const blocked = {
    ...state,
    state: "blocked",
    effectJournal: state.effectJournal.map(
      (candidate) => candidate.effectId === entry.effectId ? {
        ...candidate,
        status: "ambiguous",
        ...event.observationHash === void 0 ? {} : { observationHash: event.observationHash }
      } : candidate
    ),
    ...entry.unitId === null ? {} : {
      units: replaceUnit(state, {
        ...state.units[entry.unitId],
        state: "blocked"
      })
    }
  };
  if (entry.unitId === null || entry.kind !== "reservation_release")
    return blocked;
  return {
    ...blocked,
    closedUnitEvidence: updateClosureReleaseEvidence(blocked, entry.unitId)
  };
}
function reduceController(state, event) {
  let result2;
  switch (event.type) {
    case "controller_acquire_intent":
      if (state.state !== "initializing" || state.controller.state !== "unacquired")
        return reject(
          "illegal_transition",
          "controller acquisition is not legal"
        );
      result2 = controllerIntent(
        state,
        event,
        "controller_acquire",
        "initializing",
        "acquire_intent"
      );
      break;
    case "controller_acquired":
      if (state.state !== "initializing" && state.state !== "blocked" || state.controller.state !== "acquire_intent" || event.holder !== state.controller.holder || event.controllerFencingToken !== state.controllerFencingToken || !matchesRecoverableEffect(state, event, null, "controller_acquire"))
        return badObservation();
      result2 = {
        state: settleAmbiguityState(
          markObserved(state, event.effectId, event.observationHash, {
            state: "active",
            controller: { ...state.controller, state: "acquired" }
          })
        ),
        effects: []
      };
      break;
    case "controller_release_intent":
      if (!canReleaseController(state))
        return reject(
          "illegal_transition",
          "controller release requires closed units and released reservations"
        );
      result2 = controllerIntent(
        state,
        event,
        "controller_release",
        "release_intent",
        "release_intent"
      );
      break;
    case "controller_released":
      if (state.state !== "release_intent" && state.state !== "blocked" || state.controller.state !== "release_intent" || !matchesRecoverableEffect(state, event, null, "controller_release"))
        return badObservation();
      result2 = {
        state: settleAmbiguityState(
          markObserved(state, event.effectId, event.observationHash, {
            state: "released",
            controller: { ...state.controller, state: "released" }
          })
        ),
        effects: []
      };
      break;
    default:
      return exhaustive(event);
  }
  return commit(result2.state, event, result2.effects);
}
function controllerIntent(state, event, kind, aggregateState, controllerState) {
  return appendIntent(
    {
      ...state,
      state: aggregateState,
      controller: { ...state.controller, state: controllerState }
    },
    null,
    event,
    kind,
    "slotTransition" in event ? event.slotTransition : void 0
  );
}
function modifyingIntent(state, unit, next, event, kind, unitChanges = {}) {
  return intent(state, unit, next, event, kind, {
    activeModifyingUnitIds: [...state.activeModifyingUnitIds, unit.id],
    ...Object.keys(unitChanges).length === 0 ? {} : { units: replaceUnit(state, { ...unit, ...unitChanges }) }
  });
}
function terminalIntent(state, unit, next, event, kind) {
  const retainsQualification = state.qualificationOwnerUnitId === unit.id || state.currentReviewerUnitId === unit.id;
  return intent(state, unit, next, event, kind, {
    // An active worker or reviewer remains owned until the exact terminal
    // observation confirms that its role/session target was handled.
    activeModifyingUnitIds: state.activeModifyingUnitIds,
    qualificationQueue: retainsQualification ? state.qualificationQueue : state.qualificationQueue.filter((id) => id !== unit.id),
    integrationQueue: state.integrationQueue.filter((id) => id !== unit.id)
  });
}
function intent(state, unit, next, event, kind, changes = {}) {
  const changedUnit = changes.units?.[unit.id] ?? unit;
  const base = {
    ...state,
    ...changes,
    units: {
      ...changes.units ?? state.units,
      [unit.id]: { ...changedUnit, state: next, revision: unit.revision + 1 }
    }
  };
  return appendIntent(
    normalizeOwners(base, changes),
    unit.id,
    event,
    kind
  );
}
function appendIntent(state, unitId, event, kind, slotTransition) {
  const compacted = compactJournal(state);
  const effectId = `${event.eventId}:${kind}`;
  const params = runtimeEffectParams(
    compacted,
    unitId,
    kind,
    slotTransition
  );
  const paramsHash = deriveParamsHash(kind, params);
  const effect2 = {
    kind,
    effectId,
    unitId,
    idempotencyKey: event.idempotencyKey,
    paramsHash,
    schemaVersion: SCHEMA_VERSION,
    params
  };
  const entry = {
    effectId,
    unitId,
    idempotencyKey: event.idempotencyKey,
    kind,
    intentRevision: state.revision,
    intentCommitment: "0".repeat(64),
    paramsHash,
    status: "intended",
    ...slotTransition === void 0 ? {} : { slotTransition },
    schemaVersion: SCHEMA_VERSION
  };
  entry.intentCommitment = deriveIntentCommitment(entry);
  const validEffect = validate(RuntimeEffectSchema, effect2);
  if (!validEffect.ok)
    throw new Error(
      `runtime effect construction failed: ${validEffect.errors.join("; ")}`
    );
  return {
    state: { ...compacted, effectJournal: [...compacted.effectJournal, entry] },
    effects: [effect2]
  };
}
function runtimeEffectParams(state, unitId, kind, slotTransition) {
  if (kind === "controller_acquire")
    return {
      holder: state.controller.holder,
      controllerFencingToken: state.controllerFencingToken,
      requestedModel: state.controller.requestedModel,
      returnedModel: state.controller.returnedModel,
      promptHash: state.controller.promptHash,
      ...slotTransition === void 0 ? {} : { slotTransition }
    };
  if (kind === "controller_release")
    return {
      holder: state.controller.holder,
      controllerFencingToken: state.controllerFencingToken,
      ...slotTransition === void 0 ? {} : { slotTransition }
    };
  if (unitId === null) throw new Error(`${kind} requires a unit`);
  const unit = state.units[unitId];
  if (unit === void 0) throw new Error(`${kind} has an unknown unit`);
  const worker = () => ({
    branchRef: required(unit.branchRef, "branch ref", kind),
    worktreePath: required(unit.worktreePath, "worktree path", kind),
    requestedModel: required(unit.workerRequestedModel, "worker model", kind),
    promptHash: required(unit.workerPromptHash, "worker prompt", kind)
  });
  const candidate = () => ({
    baseOid: required(
      unit.verificationBaseOid ?? unit.baseOid,
      "candidate base",
      kind
    ),
    headOid: required(unit.candidateHead, "candidate head", kind),
    treeOid: required(unit.candidateTree, "candidate tree", kind)
  });
  switch (kind) {
    case "reservation_acquire":
      return {
        reservations: unit.reservationIds.map((id) => {
          const reservation = state.reservations[id];
          if (reservation === void 0)
            throw new Error(
              `reservation acquire has unknown reservation ${id}`
            );
          return {
            id: reservation.id,
            namespace: reservation.namespace,
            resource: reservation.resource
          };
        })
      };
    case "branch_create":
      return {
        baseOid: unit.baseOid,
        branchRef: required(unit.branchRef, "branch ref", kind)
      };
    case "worktree_create":
      return {
        branchRef: required(unit.branchRef, "branch ref", kind),
        worktreePath: required(unit.worktreePath, "worktree path", kind)
      };
    case "dispatch":
      return worker();
    case "worker_collect":
      return {
        sessionId: required(unit.workerSessionId, "worker session", kind)
      };
    case "candidate_collect":
      return {
        branchRef: required(unit.branchRef, "branch ref", kind),
        worktreePath: required(unit.worktreePath, "worktree path", kind)
      };
    case "verify":
      return {
        candidate: {
          baseOid: unit.baseOid,
          headOid: required(unit.candidateHead, "candidate head", kind),
          treeOid: required(unit.candidateTree, "candidate tree", kind)
        },
        commands: required(
          unit.verificationCommands,
          "verification commands",
          kind
        )
      };
    case "review_dispatch":
      return {
        candidate: candidate(),
        requestedModel: required(
          unit.reviewerRequestedModel,
          "reviewer model",
          kind
        ),
        promptHash: required(unit.reviewPromptHash, "reviewer prompt", kind)
      };
    case "review_collect":
      return {
        sessionId: required(unit.reviewerSessionId, "reviewer session", kind),
        candidate: candidate()
      };
    case "publish":
      return {
        branchRef: required(unit.branchRef, "branch ref", kind),
        candidate: candidate(),
        authorityProfile: state.authorityProfile,
        completionBoundary: state.completionBoundary
      };
    case "integrate":
      return {
        integrationBranch: state.integrationBranch,
        integrationProfile: state.integrationProfile,
        completionBoundary: state.completionBoundary,
        controllerFencingToken: state.controllerFencingToken,
        candidate: candidate()
      };
    case "reservation_release":
      return { reservationIds: [...unit.reservationIds] };
    case "repair": {
      const context = required(unit.repairContext, "repair context", kind);
      return {
        ...worker(),
        repairBaseOid: context.baseOid,
        ...context.headOid === void 0 ? {} : { repairHeadOid: context.headOid },
        ...context.treeOid === void 0 ? {} : { repairTreeOid: context.treeOid }
      };
    }
    case "failure":
    case "timeout":
    case "park":
    case "cancel":
      return terminalEffectParams(state, unit, kind);
    default:
      return exhaustive(kind);
  }
}
function terminalEffectParams(state, unit, kind) {
  if (state.currentReviewerUnitId === unit.id)
    return {
      role: "reviewer",
      sessionId: required(unit.reviewerSessionId, "reviewer session", kind)
    };
  if (state.activeModifyingUnitIds.includes(unit.id))
    return {
      role: "worker",
      sessionId: required(unit.workerSessionId, "worker session", kind)
    };
  return { role: "none" };
}
function required(value, name, kind) {
  if (value === void 0) throw new Error(`${kind} lacks ${name}`);
  return value;
}
function observedEffect2(state, unitId, kind) {
  const entry = [...state.effectJournal].reverse().find(
    (candidate) => candidate.unitId === unitId && candidate.kind === kind && candidate.status === "observed"
  );
  if (entry === void 0 || entry.observationHash === void 0)
    throw new Error(`missing observed ${kind} lineage for ${unitId}`);
  return entry;
}
function closureReservations(state, unit) {
  return unit.reservationIds.map((reservationId) => {
    const reservation = state.reservations[reservationId];
    if (reservation === void 0)
      throw new Error(`missing reservation ${reservationId}`);
    return {
      id: reservation.id,
      namespace: reservation.namespace,
      resource: reservation.resource,
      acquire: observedEffect2(state, unit.id, "reservation_acquire")
    };
  });
}
function sessionClosureBindings(unit) {
  return {
    ...unit.workerSessionId === void 0 ? {} : {
      worker: {
        sessionId: unit.workerSessionId,
        requestedModel: required(
          unit.workerRequestedModel,
          "worker model",
          "dispatch"
        ),
        returnedModel: required(
          unit.workerReturnedModel,
          "worker returned model",
          "dispatch"
        ),
        promptHash: required(
          unit.workerPromptHash,
          "worker prompt",
          "dispatch"
        )
      }
    },
    ...unit.reviewerSessionId === void 0 ? {} : {
      reviewer: {
        sessionId: unit.reviewerSessionId,
        requestedModel: required(
          unit.reviewerRequestedModel,
          "reviewer model",
          "review_dispatch"
        ),
        returnedModel: required(
          unit.reviewerReturnedModel,
          "reviewer returned model",
          "review_dispatch"
        ),
        promptHash: required(
          unit.reviewPromptHash,
          "review prompt",
          "review_dispatch"
        )
      }
    }
  };
}
function successfulClosureFacts(unit) {
  return {
    candidate: {
      headOid: required(unit.candidateHead, "candidate head", "integrate"),
      treeOid: required(unit.candidateTree, "candidate tree", "integrate")
    },
    verification: {
      baseOid: required(
        unit.verificationBaseOid,
        "verification base",
        "integrate"
      ),
      headOid: required(
        unit.verificationHeadOid,
        "verification head",
        "integrate"
      ),
      treeOid: required(
        unit.verificationTree,
        "verification tree",
        "integrate"
      ),
      evidenceHash: required(
        unit.verificationEvidenceHash,
        "verification evidence",
        "integrate"
      ),
      commands: required(
        unit.verificationCommands,
        "verification commands",
        "integrate"
      )
    },
    review: {
      baseOid: required(unit.reviewBaseOid, "review base", "integrate"),
      headOid: required(unit.reviewHeadOid, "review head", "integrate"),
      treeOid: required(unit.reviewTree, "review tree", "integrate"),
      responseHash: required(
        unit.approvalResponseHash,
        "approval response",
        "integrate"
      )
    }
  };
}
function closureEvidenceFor(state, unit) {
  const base = {
    unitId: unit.id,
    unitOrdinal: unit.ordinal,
    baseOid: unit.baseOid,
    ...unit.branchRef === void 0 ? {} : { branchRef: unit.branchRef },
    ...unit.worktreePath === void 0 ? {} : { worktreePath: unit.worktreePath },
    ...sessionClosureBindings(unit),
    reservations: closureReservations(state, unit)
  };
  switch (unit.state) {
    case "landed":
      return {
        ...base,
        ...successfulClosureFacts(unit),
        outcome: "landed",
        landedOid: required(unit.landedOid, "landed OID", "integrate"),
        terminalEffect: observedEffect2(state, unit.id, "integrate")
      };
    case "handoff": {
      const success2 = successfulClosureFacts(unit);
      if (unit.openPullRequest !== void 0)
        return {
          ...base,
          ...success2,
          outcome: "pr_handoff",
          publishedHeadOid: required(
            unit.publishedHeadOid,
            "published head",
            "publish"
          ),
          pullRequest: unit.openPullRequest,
          terminalEffect: observedEffect2(state, unit.id, "publish")
        };
      return {
        ...base,
        ...success2,
        outcome: "branch_handoff",
        publishedHeadOid: required(
          unit.publishedHeadOid,
          "published head",
          "publish"
        ),
        terminalEffect: observedEffect2(state, unit.id, "publish")
      };
    }
    case "failed":
    case "timed_out":
    case "parked":
    case "cancelled": {
      const terminalKind = {
        failed: "failure",
        timed_out: "timeout",
        parked: "park",
        cancelled: "cancel"
      };
      return {
        ...base,
        outcome: unit.state,
        terminalEffect: unit.state === "failed" && !state.effectJournal.some(
          (entry) => entry.unitId === unit.id && entry.kind === "failure" && entry.status === "observed"
        ) ? observedEffect2(state, unit.id, "worker_collect") : observedEffect2(state, unit.id, terminalKind[unit.state]),
        ...unit.workerResult === void 0 ? {} : { workerResult: unit.workerResult },
        ...unit.repairContext === void 0 ? {} : { repairContext: unit.repairContext },
        ...unit.candidateHead === void 0 || unit.candidateTree === void 0 ? {} : {
          candidate: {
            headOid: unit.candidateHead,
            treeOid: unit.candidateTree
          }
        }
      };
    }
    default:
      throw new Error(
        `cannot close non-terminal unit ${unit.id}/${unit.state}`
      );
  }
}
function recordClosureEvidence(state, unit) {
  const evidence = decodeClosedUnitEvidence(state.closedUnitEvidence);
  if (evidence === void 0)
    throw new Error("closed unit evidence ledger is malformed");
  return encodeClosedUnitEvidence({
    ...evidence,
    [unit.id]: closureEvidenceFor(state, unit)
  });
}
function removeClosureEvidence(state, unitId) {
  const evidence = decodeClosedUnitEvidence(state.closedUnitEvidence);
  if (evidence === void 0)
    throw new Error("closed unit evidence ledger is malformed");
  const next = { ...evidence };
  delete next[unitId];
  return { ...state, closedUnitEvidence: encodeClosedUnitEvidence(next) };
}
function invalidClosedUnitEvidenceCommitment() {
  return sha256(
    canonicalJson({ domain: "sce.protocol.closed-evidence.invalid.v1" })
  );
}
function closedUnitEvidenceCommitment(dense) {
  if (Object.keys(dense.u).length === 0) return "0".repeat(64);
  return sha256(
    canonicalJson({
      domain: "sce.protocol.closed-evidence.v1",
      evidence: dense
    })
  );
}
function denseJournal(entry) {
  return [
    entry.effectId,
    entry.unitId,
    entry.idempotencyKey,
    entry.kind,
    entry.intentRevision,
    entry.intentCommitment,
    entry.paramsHash,
    entry.status,
    entry.observationHash ?? null,
    entry.schemaVersion
  ];
}
function denseBinding(binding) {
  return binding === void 0 ? null : [
    binding.sessionId,
    binding.requestedModel,
    binding.returnedModel,
    binding.promptHash
  ];
}
function denseClosureRecord(closure) {
  const common = [
    closure.outcome,
    closure.unitId,
    closure.unitOrdinal,
    closure.baseOid,
    closure.repairCount ?? null,
    closure.branchRef ?? null,
    closure.worktreePath ?? null,
    denseBinding(closure.worker),
    denseBinding(closure.reviewer),
    closure.reservations.map((reservation) => [
      reservation.id,
      reservation.namespace,
      reservation.resource,
      denseJournal(reservation.acquire),
      reservation.release === void 0 ? null : denseJournal(reservation.release)
    ]),
    denseJournal(closure.terminalEffect)
  ];
  if (closure.outcome === "landed" || closure.outcome === "branch_handoff" || closure.outcome === "pr_handoff") {
    const success2 = [
      [closure.candidate.headOid, closure.candidate.treeOid],
      [
        closure.verification.baseOid,
        closure.verification.headOid,
        closure.verification.treeOid,
        closure.verification.evidenceHash,
        closure.verification.commands
      ],
      [
        closure.review.baseOid,
        closure.review.headOid,
        closure.review.treeOid,
        closure.review.responseHash
      ]
    ];
    if (closure.outcome === "landed")
      return [...common, [closure.landedOid, ...success2]];
    if (closure.outcome === "branch_handoff")
      return [...common, [closure.publishedHeadOid, ...success2]];
    return [
      ...common,
      [
        closure.publishedHeadOid,
        [
          closure.pullRequest.providerPrId,
          closure.pullRequest.url ?? null,
          closure.pullRequest.state,
          closure.pullRequest.baseRef,
          closure.pullRequest.baseOid,
          closure.pullRequest.remoteHeadOid
        ],
        ...success2
      ]
    ];
  }
  return [
    ...common,
    [
      closure.workerResult === void 0 ? null : [
        closure.workerResult.status,
        closure.workerResult.summary,
        closure.workerResult.residualRisks,
        closure.workerResult.suggestedFollowUps
      ],
      closure.repairContext === void 0 ? null : [
        closure.repairContext.baseOid,
        closure.repairContext.headOid ?? null,
        closure.repairContext.treeOid ?? null,
        closure.repairContext.responseHash,
        closure.repairContext.rationale,
        closure.repairContext.findings.map((finding) => [
          finding.id,
          finding.severity,
          finding.detail
        ])
      ],
      closure.candidate === void 0 ? null : [closure.candidate.headOid, closure.candidate.treeOid]
    ]
  ];
}
function denseClosureLedger(evidence) {
  return {
    v: 1,
    u: Object.fromEntries(
      Object.entries(evidence).map(([id, closure]) => [
        id,
        denseClosureRecord(closure)
      ])
    )
  };
}
function tuple(value, length) {
  return Array.isArray(value) && value.length === length ? value : void 0;
}
function denseJournalEntry(value) {
  const values = tuple(value, 10);
  if (values === void 0) return void 0;
  const [
    effectId,
    unitId,
    idempotencyKey2,
    kind,
    intentRevision,
    intentCommitment,
    paramsHash,
    status,
    observationHash2,
    schemaVersion
  ] = values;
  if (observationHash2 !== null && typeof observationHash2 !== "string")
    return void 0;
  return {
    effectId,
    unitId,
    idempotencyKey: idempotencyKey2,
    kind,
    intentRevision,
    intentCommitment,
    paramsHash,
    status,
    ...observationHash2 === null ? {} : { observationHash: observationHash2 },
    schemaVersion
  };
}
function denseBindingRecord(value) {
  if (value === null) return void 0;
  const values = tuple(value, 4);
  if (values === void 0) return null;
  const [sessionId, requestedModel, returnedModel, promptHash] = values;
  return {
    sessionId,
    requestedModel,
    returnedModel,
    promptHash
  };
}
function denseReservations(value) {
  if (!Array.isArray(value)) return void 0;
  const reservations = [];
  for (const encoded of value) {
    const values = tuple(encoded, 5);
    if (values === void 0) return void 0;
    const [id, namespace, resource, acquireEncoded, releaseEncoded] = values;
    const acquire = denseJournalEntry(acquireEncoded);
    const release = releaseEncoded === null ? void 0 : denseJournalEntry(releaseEncoded);
    if (acquire === void 0 || releaseEncoded !== null && release === void 0)
      return void 0;
    reservations.push({
      id,
      namespace,
      resource,
      acquire,
      ...release === void 0 ? {} : { release }
    });
  }
  return reservations;
}
function denseSuccess(value) {
  if (!Array.isArray(value) || value.length !== 4 && value.length !== 5)
    return void 0;
  const [publishedOrLandedOid, second, third, fourth, fifth] = value;
  const hasPullRequest = value.length === 5;
  return {
    publishedOrLandedOid,
    ...hasPullRequest ? { pullRequest: second } : {},
    candidate: hasPullRequest ? third : second,
    verification: hasPullRequest ? fourth : third,
    review: hasPullRequest ? fifth : fourth
  };
}
function expandDenseClosure(value) {
  const values = tuple(value, 12);
  if (values === void 0) return void 0;
  const [
    outcome,
    unitId,
    unitOrdinal,
    baseOid,
    repairCount,
    branchRef,
    worktreePath,
    workerEncoded,
    reviewerEncoded,
    reservationsEncoded,
    terminalEncoded,
    payload
  ] = values;
  if (repairCount !== null && typeof repairCount !== "number" || branchRef !== null && typeof branchRef !== "string" || worktreePath !== null && typeof worktreePath !== "string")
    return void 0;
  const worker = denseBindingRecord(workerEncoded);
  const reviewer = denseBindingRecord(reviewerEncoded);
  const reservations = denseReservations(reservationsEncoded);
  const terminalEffect = denseJournalEntry(terminalEncoded);
  if (worker === null || reviewer === null || reservations === void 0 || terminalEffect === void 0)
    return void 0;
  const base = {
    unitId,
    unitOrdinal,
    baseOid,
    ...repairCount === null ? {} : { repairCount },
    ...branchRef === null ? {} : { branchRef },
    ...worktreePath === null ? {} : { worktreePath },
    ...worker === void 0 ? {} : { worker },
    ...reviewer === void 0 ? {} : { reviewer },
    reservations,
    terminalEffect
  };
  if (outcome === "landed" || outcome === "branch_handoff" || outcome === "pr_handoff") {
    const success2 = denseSuccess(payload);
    const candidate2 = success2 === void 0 ? void 0 : tuple(success2.candidate, 2);
    const verification = success2 === void 0 ? void 0 : tuple(success2.verification, 5);
    const review = success2 === void 0 ? void 0 : tuple(success2.review, 4);
    if (success2 === void 0 || candidate2 === void 0 || verification === void 0 || review === void 0)
      return void 0;
    const successFacts = {
      candidate: { headOid: candidate2[0], treeOid: candidate2[1] },
      verification: {
        baseOid: verification[0],
        headOid: verification[1],
        treeOid: verification[2],
        evidenceHash: verification[3],
        commands: verification[4]
      },
      review: {
        baseOid: review[0],
        headOid: review[1],
        treeOid: review[2],
        responseHash: review[3]
      }
    };
    if (outcome === "landed")
      return {
        ...base,
        ...successFacts,
        outcome,
        landedOid: success2.publishedOrLandedOid
      };
    if (outcome === "branch_handoff")
      return {
        ...base,
        ...successFacts,
        outcome,
        publishedHeadOid: success2.publishedOrLandedOid
      };
    const pullRequest = tuple(success2.pullRequest, 6);
    if (pullRequest === void 0 || pullRequest[1] !== null && typeof pullRequest[1] !== "string")
      return void 0;
    return {
      ...base,
      ...successFacts,
      outcome,
      publishedHeadOid: success2.publishedOrLandedOid,
      pullRequest: {
        providerPrId: pullRequest[0],
        ...pullRequest[1] === null ? {} : { url: pullRequest[1] },
        state: pullRequest[2],
        baseRef: pullRequest[3],
        baseOid: pullRequest[4],
        remoteHeadOid: pullRequest[5]
      }
    };
  }
  if (outcome !== "failed" && outcome !== "timed_out" && outcome !== "parked" && outcome !== "cancelled")
    return void 0;
  const negative = tuple(payload, 3);
  if (negative === void 0) return void 0;
  const [workerResultEncoded, repairContextEncoded, candidateEncoded] = negative;
  const workerResult = workerResultEncoded === null ? void 0 : tuple(workerResultEncoded, 4);
  const repairContext = repairContextEncoded === null ? void 0 : tuple(repairContextEncoded, 6);
  const candidate = candidateEncoded === null ? void 0 : tuple(candidateEncoded, 2);
  if (workerResult === void 0 && workerResultEncoded !== null || repairContext === void 0 && repairContextEncoded !== null || candidate === void 0 && candidateEncoded !== null)
    return void 0;
  if (repairContext !== void 0 && (repairContext[1] !== null && typeof repairContext[1] !== "string" || repairContext[2] !== null && typeof repairContext[2] !== "string" || !Array.isArray(repairContext[5]) || !repairContext[5].every((finding) => tuple(finding, 3) !== void 0)))
    return void 0;
  return {
    ...base,
    outcome,
    ...workerResult === void 0 ? {} : {
      workerResult: {
        status: workerResult[0],
        summary: workerResult[1],
        residualRisks: workerResult[2],
        suggestedFollowUps: workerResult[3]
      }
    },
    ...repairContext === void 0 ? {} : {
      repairContext: {
        baseOid: repairContext[0],
        ...repairContext[1] === null ? {} : { headOid: repairContext[1] },
        ...repairContext[2] === null ? {} : { treeOid: repairContext[2] },
        responseHash: repairContext[3],
        rationale: repairContext[4],
        findings: repairContext[5].map(
          (finding) => {
            const [id, severity, detail] = tuple(finding, 3);
            return { id, severity, detail };
          }
        )
      }
    },
    ...candidate === void 0 ? {} : { candidate: { headOid: candidate[0], treeOid: candidate[1] } }
  };
}
function encodeClosedUnitEvidence(evidence) {
  if (Object.keys(evidence).length === 0) return "";
  const dense = denseClosureLedger(evidence);
  return deflateRawSync(
    Buffer.from(canonicalJson(dense), "utf8"),
    {
      level: 9
    }
  ).toString("base64");
}
function decodeClosedUnitEvidenceDetails(encoded) {
  if (encoded === "") {
    const dense2 = { v: 1, u: {} };
    return {
      dense: dense2,
      evidence: {},
      commitment: closedUnitEvidenceCommitment(dense2)
    };
  }
  let compressed;
  let decoded;
  try {
    compressed = Buffer.from(encoded, "base64");
    if (compressed.toString("base64") !== encoded) return void 0;
    const inflated = inflateRawSync(compressed, {
      info: true,
      maxOutputLength: LIMITS.envelopeBytes
    });
    if (inflated.engine.bytesWritten !== compressed.length) return void 0;
    decoded = inflated.buffer;
  } catch {
    return void 0;
  }
  if (decoded.length > LIMITS.envelopeBytes) return void 0;
  const text4 = decoded.toString("utf8");
  if (!Buffer.from(text4, "utf8").equals(decoded)) return void 0;
  let parsed;
  try {
    parsed = JSON.parse(text4);
  } catch {
    return void 0;
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object" || canonicalJson(parsed) !== text4)
    return void 0;
  const parsedDense = parsed;
  if (Object.keys(parsedDense).length !== 2 || parsedDense.v !== 1 || parsedDense.u === null || Array.isArray(parsedDense.u) || typeof parsedDense.u !== "object")
    return void 0;
  const dense = { v: 1, u: parsedDense.u };
  const evidence = {};
  for (const [id, compact] of Object.entries(dense.u)) {
    const facts = expandDenseClosure(compact);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(id) || facts === void 0 || !validate(ClosureEvidenceSchema, facts).ok)
      return void 0;
    evidence[id] = facts;
  }
  return {
    dense,
    evidence,
    commitment: closedUnitEvidenceCommitment(dense)
  };
}
function decodeClosedUnitEvidence(encoded) {
  return decodeClosedUnitEvidenceDetails(encoded)?.evidence;
}
function updateClosureReleaseEvidence(state, unitId) {
  const evidence = decodeClosedUnitEvidence(state.closedUnitEvidence);
  const record2 = evidence?.[unitId];
  const release = [...state.effectJournal].reverse().find(
    (entry) => entry.unitId === unitId && entry.kind === "reservation_release"
  );
  if (evidence === void 0 || record2 === void 0 || release === void 0)
    throw new Error(`missing closure release lineage for ${unitId}`);
  return encodeClosedUnitEvidence({
    ...evidence,
    [unitId]: {
      ...record2,
      reservations: record2.reservations.map((reservation) => ({
        ...reservation,
        release
      }))
    }
  });
}
function closeUnitAfterRelease(state, unitId) {
  const closedUnit = state.units[unitId];
  if (closedUnit === void 0)
    throw new Error(`missing released unit ${unitId}`);
  const releasedEvidence = updateClosureReleaseEvidence(state, unitId);
  const evidence = decodeClosedUnitEvidence(releasedEvidence);
  const record2 = evidence?.[unitId];
  if (evidence === void 0 || record2 === void 0)
    throw new Error(`missing final closure evidence for ${unitId}`);
  const closedUnitEvidence = encodeClosedUnitEvidence({
    ...evidence,
    [unitId]: {
      ...record2,
      repairCount: closedUnit.repairCount
    }
  });
  const units = { ...state.units };
  delete units[unitId];
  const reservations = Object.fromEntries(
    Object.entries(state.reservations).filter(
      ([, reservation]) => reservation.unitId !== unitId
    )
  );
  return {
    ...state,
    units,
    reservations,
    wave: {
      ...state.wave,
      unitIds: state.wave.unitIds.filter((id) => id !== unitId)
    },
    closedUnitEvidence
  };
}
function persistTerminalClosureEvidence(step, unitId) {
  const unit = step.state.units[unitId];
  if (unit === void 0) throw new Error(`missing terminal unit ${unitId}`);
  return {
    ...step,
    state: {
      ...step.state,
      closedUnitEvidence: recordClosureEvidence(step.state, unit)
    }
  };
}
function compactJournal(state) {
  const anchored = new Set(
    Object.values(state.reservations).flatMap((reservation) => [
      reservation.state === "released" ? void 0 : reservation.acquireEffectId,
      reservation.state === "released" ? reservation.releaseEffectId : void 0
    ]).filter((effectId) => effectId !== void 0)
  );
  const retained = state.effectJournal.filter(
    (entry) => entry.status !== "observed" || anchored.has(entry.effectId)
  );
  const compactedEntries = state.effectJournal.filter(
    (entry) => entry.status === "observed" && !anchored.has(entry.effectId)
  );
  const compacted = state.effectJournal.length - retained.length;
  return compacted === 0 ? state : {
    ...state,
    effectJournal: retained,
    journalCheckpoint: {
      revision: state.revision,
      commitment: deriveJournalCommitment(
        state.journalCheckpoint.commitment,
        compactedEntries
      ),
      compactedEffects: state.journalCheckpoint.compactedEffects + compacted,
      compactedEvents: state.journalCheckpoint.compactedEvents,
      compactedIdempotencyKeys: state.journalCheckpoint.compactedIdempotencyKeys
    }
  };
}
function observe(state, unit, next, event, unitChanges = {}, aggregateChanges = {}, replacementUnit) {
  const nextUnit = {
    ...replacementUnit ?? { ...unit, ...unitChanges },
    state: next,
    revision: unit.revision + 1
  };
  const nextState = markObserved(
    {
      ...state,
      ...aggregateChanges,
      units: replaceUnit(state, nextUnit)
    },
    event.effectId,
    event.observationHash
  );
  return {
    state: settleAmbiguityState(normalizeOwners(nextState, aggregateChanges)),
    effects: []
  };
}
function markObserved(state, effectId, observationHash2, changes = {}) {
  return {
    ...state,
    ...changes,
    effectJournal: state.effectJournal.map(
      (entry) => entry.effectId === effectId ? { ...entry, status: "observed", observationHash: observationHash2 } : entry
    )
  };
}
function normalizeOwners(state, changes) {
  const next = { ...state };
  if (changes.qualificationOwnerUnitId === null)
    delete next.qualificationOwnerUnitId;
  if (changes.integrationOwnerUnitId === null)
    delete next.integrationOwnerUnitId;
  if (changes.currentReviewerUnitId === null) delete next.currentReviewerUnitId;
  return next;
}
function settleAmbiguityState(state) {
  const hasAmbiguity = state.effectJournal.some(
    (entry) => entry.status === "ambiguous"
  );
  if (hasAmbiguity && state.state !== "blocked")
    return { ...state, state: "blocked" };
  if (!hasAmbiguity && state.state === "blocked")
    return { ...state, state: "active" };
  return state;
}
function replaceUnit(state, unit) {
  return { ...state.units, [unit.id]: unit };
}
function matchesIntended(state, event, unitId, kind) {
  return state.effectJournal.some(
    (entry) => entry.effectId === event.effectId && entry.unitId === unitId && entry.kind === kind && entry.kind === event.effectKind && entry.status === "intended"
  );
}
function matchesRecoverableEffect(state, event, unitId, kind) {
  return state.effectJournal.some(
    (entry) => entry.effectId === event.effectId && entry.unitId === unitId && entry.kind === kind && entry.kind === event.effectKind && (entry.status === "intended" || entry.status === "ambiguous")
  );
}
function badObservation() {
  return reject(
    "illegal_transition",
    "observation does not match an intended effect id, unit, kind, and status"
  );
}
function workerSession(event) {
  return {
    workerSessionId: event.sessionId,
    workerRequestedModel: event.requestedModel,
    workerReturnedModel: event.returnedModel,
    workerPromptHash: event.promptHash
  };
}
function reviewerSession(event) {
  return {
    reviewerSessionId: event.sessionId,
    reviewerRequestedModel: event.requestedModel,
    reviewerReturnedModel: event.returnedModel,
    reviewPromptHash: event.promptHash
  };
}
function reviewJudgmentError(unit, judgment, revision3) {
  if (judgment.role !== "reviewer" || judgment.kind !== "review_verdict" || judgment.unitId !== unit.id)
    return "review judgment has wrong role, kind, or unit";
  if (judgment.aggregateRevision !== revision3 || judgment.sessionId !== unit.reviewerSessionId || judgment.requestedModel !== unit.reviewerRequestedModel || judgment.returnedModel !== unit.reviewerReturnedModel || judgment.promptHash !== unit.reviewPromptHash)
    return "review judgment is not bound to the dispatched reviewer session, model, prompt, and revision";
  if (judgment.baseOid !== unit.verificationBaseOid || judgment.headOid !== unit.candidateHead || judgment.treeOid !== unit.candidateTree)
    return "review judgment is not bound to the verified base, head, and tree";
  if (judgment.decision === "approve" && judgment.findings.some((finding) => finding.severity === "blocking"))
    return "approval cannot contain blocking findings";
  return void 0;
}
function validRepairJudgment(state, unit, judgment, revision3) {
  const context = unit.repairContext;
  return context !== void 0 && judgment.role === "controller" && judgment.kind === "repair_disposition" && judgment.unitId === unit.id && judgment.aggregateRevision === revision3 && judgment.sessionId === state.controller.incarnationId && judgment.requestedModel === state.controller.requestedModel && judgment.returnedModel === state.controller.returnedModel && judgment.factOid === (context.headOid ?? context.baseOid) && judgment.currentEvidenceHash === context.responseHash && judgment.findingsContextHash === deriveRepairContextHash(context) && judgment.promptHash === deriveRepairJudgmentPromptHash(state, unit, judgment) && judgment.responseHash === deriveRepairJudgmentResponseHash(judgment) && (context.headOid === void 0 || context.headOid === unit.candidateHead) && judgment.decision === "repair";
}
function failureRepairContext(unit, responseHash, rationale) {
  if (unit.candidateHead === void 0 || unit.candidateTree === void 0)
    return {};
  return {
    repairContext: {
      baseOid: unit.verificationBaseOid ?? unit.baseOid,
      headOid: unit.candidateHead,
      treeOid: unit.candidateTree,
      responseHash,
      rationale,
      findings: [
        { id: "runtime-failure", severity: "blocking", detail: rationale }
      ]
    }
  };
}
function isCurrentApproval(unit) {
  return unit.state === "approved" && unit.reviewBaseOid === unit.baseOid && unit.reviewHeadOid === unit.candidateHead && unit.reviewTree === unit.candidateTree && unit.approvalResponseHash !== void 0;
}
function hasCurrentApproval(unit) {
  return unit.reviewBaseOid === unit.baseOid && unit.reviewHeadOid === unit.candidateHead && unit.reviewTree === unit.candidateTree && unit.approvalResponseHash !== void 0;
}
function insertSorted(values, value) {
  return values.includes(value) ? [...values] : [...values, value].sort();
}
function updateReservations(state, unitId, next, effectId) {
  return Object.fromEntries(
    Object.entries(state.reservations).map(([id, reservation]) => [
      id,
      reservation.unitId !== unitId ? reservation : {
        ...reservation,
        state: next,
        ...next === "reserved" && effectId !== void 0 ? { acquireEffectId: effectId } : {},
        ...next === "released" && effectId !== void 0 ? { releaseEffectId: effectId } : {}
      }
    ])
  );
}
function clearUnitOwners(state, unitId) {
  return {
    activeModifyingUnitIds: state.activeModifyingUnitIds.filter(
      (id) => id !== unitId
    ),
    qualificationQueue: state.qualificationQueue.filter((id) => id !== unitId),
    integrationQueue: state.integrationQueue.filter((id) => id !== unitId),
    ...state.qualificationOwnerUnitId === unitId ? { qualificationOwnerUnitId: null } : {},
    ...state.integrationOwnerUnitId === unitId ? { integrationOwnerUnitId: null } : {},
    ...state.currentReviewerUnitId === unitId ? { currentReviewerUnitId: null } : {}
  };
}
function canReleaseController(state) {
  return state.controller.state === "acquired" && state.activeModifyingUnitIds.length === 0 && state.qualificationOwnerUnitId === void 0 && state.integrationOwnerUnitId === void 0 && state.currentReviewerUnitId === void 0 && Object.keys(state.units).length === 0 && Object.keys(state.reservations).length === 0;
}
function commit(state, event, effects) {
  const eventIds = [...state.processedEventIds, event.eventId];
  const idempotencyKeys = "idempotencyKey" in event ? [...state.processedIdempotencyKeys, event.idempotencyKey] : state.processedIdempotencyKeys;
  const compactedEvents = Math.max(0, eventIds.length - 256);
  const compactedIdempotencyKeys = Math.max(0, idempotencyKeys.length - 256);
  const uncommittedState = {
    ...state,
    revision: state.revision + 1,
    processedEventIds: eventIds.slice(-256),
    processedIdempotencyKeys: idempotencyKeys.slice(-256),
    journalCheckpoint: {
      ...state.journalCheckpoint,
      revision: compactedEvents > 0 || compactedIdempotencyKeys > 0 ? state.revision + 1 : state.journalCheckpoint.revision,
      compactedEvents: state.journalCheckpoint.compactedEvents + compactedEvents,
      compactedIdempotencyKeys: state.journalCheckpoint.compactedIdempotencyKeys + compactedIdempotencyKeys
    }
  };
  const closedEvidenceDetails = decodeClosedUnitEvidenceDetails(
    uncommittedState.closedUnitEvidence
  );
  const nextState = {
    ...uncommittedState,
    closedUnitEvidenceCommitment: closedEvidenceDetails?.commitment ?? invalidClosedUnitEvidenceCommitment(),
    journalCommitment: deriveJournalCommitment(
      uncommittedState.journalCheckpoint.commitment,
      uncommittedState.effectJournal
    )
  };
  const schema = validate(RepositoryRunSchema, nextState);
  if (!schema.ok) return reject("invariant", schema.errors.join("; "));
  const errors = runInvariantErrorsWithClosedEvidence(
    nextState,
    closedEvidenceDetails
  );
  return errors.length ? reject("invariant", errors.join("; ")) : { ok: true, nextState, effects };
}
function runInvariantErrors(state) {
  return runInvariantErrorsWithClosedEvidence(
    state,
    decodeClosedUnitEvidenceDetails(state.closedUnitEvidence)
  );
}
function runInvariantErrorsWithClosedEvidence(state, closedEvidenceDetails) {
  const errors = [];
  const effectIds = /* @__PURE__ */ new Set();
  const idempotency = /* @__PURE__ */ new Set();
  const waveIds = new Set(state.wave.unitIds);
  const unresolvedByUnit = /* @__PURE__ */ new Map();
  const addUnresolved = (entry) => {
    if (entry.unitId === null) return;
    const entries = unresolvedByUnit.get(entry.unitId) ?? [];
    entries.push(entry);
    unresolvedByUnit.set(entry.unitId, entries);
  };
  if (utf82.encode(
    JSON.stringify({
      schema: "sce.repository-run",
      version: SCHEMA_VERSION,
      payload: state
    })
  ).byteLength > LIMITS.envelopeBytes)
    errors.push("repository run envelope exceeds byte limit");
  if (state.controller.holder !== `${state.controller.runId}/${state.controller.incarnationId}`)
    errors.push("controller holder does not bind immutable run incarnation");
  const completionError = completionConfigurationError(state);
  if (completionError !== void 0) errors.push(completionError);
  if (state.wave.unitIds.length > 3)
    errors.push("wave exceeds the three-unit implementation cap");
  for (const queue of [
    state.wave.unitIds,
    state.qualificationQueue,
    state.integrationQueue,
    state.activeModifyingUnitIds
  ])
    if (new Set(queue).size !== queue.length || queue.some((id) => state.units[id] === void 0))
      errors.push("queue contains duplicate or unknown unit");
  for (const queue of [state.qualificationQueue, state.integrationQueue]) {
    if (queue.join("\0") !== [...queue].sort().join("\0"))
      errors.push("queue order is not deterministic");
    if (queue.some((id) => !waveIds.has(id)))
      errors.push("queue contains a unit outside the current wave");
  }
  const oidLength = state.gitObjectFormat === "sha1" ? 40 : 64;
  const checkOid = (unit, value) => {
    if (value !== void 0 && value.length !== oidLength)
      errors.push(
        `unit ${unit.id} has an OID incompatible with repository object format`
      );
  };
  for (const unit of Object.values(state.units)) {
    for (const value of [
      unit.baseOid,
      unit.candidateHead,
      unit.candidateTree,
      unit.publishedHeadOid,
      unit.verificationBaseOid,
      unit.verificationHeadOid,
      unit.verificationTree,
      unit.reviewBaseOid,
      unit.reviewHeadOid,
      unit.reviewTree,
      unit.landedOid,
      unit.openPullRequest?.baseOid,
      unit.openPullRequest?.remoteHeadOid,
      unit.repairContext?.baseOid,
      unit.repairContext?.headOid,
      unit.repairContext?.treeOid
    ])
      checkOid(unit, value);
    if (unit.repairContext?.headOid === void 0 && unit.repairContext?.treeOid !== void 0)
      errors.push(`repair context ${unit.id} has a tree without a head`);
  }
  const sessionLineage = decodeSessionLineage(state.sessionLineage);
  const hasCurrentSessionLineage = (sessionId, ordinal, role) => {
    if (sessionLineage === void 0) return false;
    const fingerprint = sessionFingerprint(sessionId);
    const start = sessionRoleSlot(ordinal, role);
    return sessionLineage.slots.slice(start, start + sessionsPerRole()).some((entry) => entry?.equals(fingerprint));
  };
  if (sessionLineage === void 0)
    errors.push("session lineage ledger is invalid");
  else if (sessionLineage.count !== state.usedSessionCount)
    errors.push("session lineage count does not match ledger");
  else if (state.sessionLineageRoot !== deriveSessionLineageRoot(state.sessionLineage, state.usedSessionCount))
    errors.push("session lineage root does not match ledger");
  const closedEvidence = closedEvidenceDetails?.evidence;
  if (closedEvidenceDetails === void 0)
    errors.push("closed unit evidence ledger is invalid");
  else if (state.closedUnitEvidenceCommitment !== closedEvidenceDetails.commitment)
    errors.push("closed unit evidence commitment does not match ledger");
  const liveTerminalStates = /* @__PURE__ */ new Set([
    "landed",
    "handoff",
    "failed",
    "timed_out",
    "parked",
    "cancelled",
    "reservation_release_intent"
  ]);
  const liveOrdinals = /* @__PURE__ */ new Set();
  for (const unit of Object.values(state.units)) {
    if (liveOrdinals.has(unit.ordinal))
      errors.push(`unit ${unit.id} duplicates a stable ordinal`);
    liveOrdinals.add(unit.ordinal);
    const closure = closedEvidence?.[unit.id];
    const ambiguousRelease = state.effectJournal.some(
      (effect2) => effect2.unitId === unit.id && effect2.kind === "reservation_release" && effect2.status === "ambiguous"
    );
    const blockedReleaseRecovery = unit.state === "blocked" && ambiguousRelease;
    if (liveTerminalStates.has(unit.state) && closure === void 0)
      errors.push(`terminal unit ${unit.id} lacks persisted closure evidence`);
    if (closure !== void 0 && (closure.unitId !== unit.id || closure.unitOrdinal !== unit.ordinal || closure.baseOid !== unit.baseOid || closure.repairCount !== void 0))
      errors.push(
        `closure evidence ${unit.id} disagrees with live terminal unit`
      );
    if (!liveTerminalStates.has(unit.state) && !blockedReleaseRecovery && closure !== void 0)
      errors.push(`non-terminal unit ${unit.id} has closure evidence`);
    if (unit.state === "reservation_release_intent") {
      if (closure === void 0 || !closure.reservations.every(
        (reservation) => reservation.release?.status === "intended" && reservation.release.observationHash === void 0
      ))
        errors.push(
          `release intent ${unit.id} lacks exact closure release lineage`
        );
    }
  }
  const closureOrdinals = /* @__PURE__ */ new Set();
  for (const [id, closure] of Object.entries(closedEvidence ?? {})) {
    if (id !== closure.unitId)
      errors.push(`closure evidence key ${id} does not match unit id`);
    if (closureOrdinals.has(closure.unitOrdinal))
      errors.push(`closure evidence ${id} duplicates a stable ordinal`);
    closureOrdinals.add(closure.unitOrdinal);
    if (liveOrdinals.has(closure.unitOrdinal) && state.units[id] === void 0)
      errors.push(`closure evidence ${id} aliases a live unit ordinal`);
    if (state.units[id] === void 0 && closure.repairCount === void 0)
      errors.push(`closed evidence ${id} lacks authoritative repair count`);
    if (state.units[id] !== void 0 && closure.repairCount !== void 0)
      errors.push(`live terminal ${id} duplicates authoritative repair count`);
    for (const value of [
      closure.baseOid,
      ..."candidate" in closure && closure.candidate !== void 0 ? [closure.candidate.headOid, closure.candidate.treeOid] : [],
      ..."verification" in closure ? [
        closure.verification.baseOid,
        closure.verification.headOid,
        closure.verification.treeOid
      ] : [],
      ..."review" in closure ? [
        closure.review.baseOid,
        closure.review.headOid,
        closure.review.treeOid
      ] : [],
      ...closure.outcome === "landed" ? [closure.landedOid] : [],
      ...closure.outcome === "branch_handoff" || closure.outcome === "pr_handoff" ? [closure.publishedHeadOid] : []
    ])
      if (value.length !== oidLength)
        errors.push(`closure evidence ${id} has an incompatible OID`);
    for (const reservation of closure.reservations) {
      const unit = state.units[id];
      const expectedReleaseStatus = unit === void 0 ? "observed" : unit.state === "reservation_release_intent" ? "intended" : unit.state === "blocked" && state.effectJournal.some(
        (effect2) => effect2.unitId === id && effect2.kind === "reservation_release" && effect2.status === "ambiguous"
      ) ? "ambiguous" : void 0;
      if (reservation.acquire.intentCommitment !== deriveIntentCommitment(reservation.acquire))
        errors.push(
          `closure evidence ${id} has an invalid reservation acquire intent`
        );
      if (reservation.acquire.unitId !== id || reservation.acquire.kind !== "reservation_acquire" || reservation.acquire.status !== "observed")
        errors.push(
          `closure evidence ${id} lacks exact reservation acquisition lineage`
        );
      else if (expectedReleaseStatus !== void 0 && reservation.release === void 0 || reservation.release !== void 0 && (reservation.release.unitId !== id || reservation.release.kind !== "reservation_release" || reservation.release.intentCommitment !== deriveIntentCommitment(reservation.release) || expectedReleaseStatus !== void 0 && reservation.release.status !== expectedReleaseStatus))
        errors.push(
          `closure evidence ${id} has invalid reservation release lineage`
        );
    }
    for (const [role, binding] of [
      ["worker", closure.worker],
      ["reviewer", closure.reviewer]
    ])
      if (binding !== void 0 && !hasCurrentSessionLineage(binding.sessionId, closure.unitOrdinal, role))
        errors.push(`closure ${id} lacks ${role} session lineage`);
    const failedWorker = "workerResult" in closure && closure.workerResult?.status === "failed";
    const expectedTerminalKinds = {
      landed: ["integrate"],
      branch_handoff: ["publish"],
      pr_handoff: ["publish"],
      failed: failedWorker ? ["failure", "worker_collect"] : ["failure"],
      timed_out: ["timeout"],
      parked: ["park"],
      cancelled: ["cancel"]
    };
    if (closure.terminalEffect.unitId !== id || closure.terminalEffect.status !== "observed" || !expectedTerminalKinds[closure.outcome].includes(
      closure.terminalEffect.kind
    ) || closure.terminalEffect.intentCommitment !== deriveIntentCommitment(closure.terminalEffect))
      errors.push(`closure evidence ${id} has invalid terminal effect lineage`);
    if (closure.outcome === "failed" && closure.terminalEffect.kind === "worker_collect" && closure.workerResult?.status !== "failed")
      errors.push(`closure evidence ${id} lacks failed worker terminal facts`);
    if (closure.outcome === "landed" || closure.outcome === "branch_handoff" || closure.outcome === "pr_handoff") {
      if (closure.verification.baseOid !== closure.baseOid || closure.candidate.headOid !== closure.verification.headOid || closure.candidate.treeOid !== closure.verification.treeOid || closure.review.baseOid !== closure.baseOid || closure.review.headOid !== closure.candidate.headOid || closure.review.treeOid !== closure.candidate.treeOid)
        errors.push(`closure evidence ${id} has mismatched successful facts`);
    }
  }
  if (state.journalCommitment !== deriveJournalCommitment(
    state.journalCheckpoint.commitment,
    state.effectJournal
  ))
    errors.push("journal commitment does not match exact entries");
  const hasAmbiguousEffect = state.effectJournal.some(
    (effect2) => effect2.status === "ambiguous"
  );
  if (hasAmbiguousEffect && state.state !== "blocked")
    errors.push("ambiguous effects require a blocked aggregate");
  if (!hasAmbiguousEffect && state.state === "blocked")
    errors.push("blocked aggregate lacks an ambiguous effect");
  for (const effect2 of state.effectJournal) {
    if (effectIds.has(effect2.effectId))
      errors.push(`duplicate effect id ${effect2.effectId}`);
    effectIds.add(effect2.effectId);
    if (idempotency.has(effect2.idempotencyKey))
      errors.push(`duplicate idempotency key ${effect2.idempotencyKey}`);
    idempotency.add(effect2.idempotencyKey);
    if (effect2.unitId !== null && state.units[effect2.unitId] === void 0 && (closedEvidence?.[effect2.unitId] === void 0 || effect2.status !== "observed"))
      errors.push(`effect ${effect2.effectId} has unknown unit`);
    if (effect2.intentCommitment !== deriveIntentCommitment(effect2))
      errors.push(`effect ${effect2.effectId} has an invalid intent commitment`);
    if (effect2.status === "intended" && effect2.observationHash !== void 0)
      errors.push(`intended effect ${effect2.effectId} has an observation`);
    if (effect2.status === "observed" && effect2.observationHash === void 0)
      errors.push(`observed effect ${effect2.effectId} has no observation`);
    if (effect2.status === "intended" || effect2.status === "ambiguous")
      addUnresolved(effect2);
    if (effect2.unitId !== null && (effect2.status === "intended" || effect2.status === "ambiguous") && !waveIds.has(effect2.unitId))
      errors.push(
        `unresolved effect ${effect2.effectId} is outside the current wave`
      );
    if (effect2.status === "intended" || effect2.status === "ambiguous") {
      try {
        const expectedParams = runtimeEffectParams(
          state,
          effect2.unitId,
          effect2.kind,
          effect2.slotTransition
        );
        if (effect2.paramsHash !== deriveParamsHash(effect2.kind, expectedParams))
          errors.push(`effect ${effect2.effectId} has an invalid params hash`);
      } catch {
        errors.push(
          `effect ${effect2.effectId} lacks reconstructable parameters`
        );
      }
    }
  }
  const intentByState = {
    reservation_intent: "reservation_acquire",
    branch_intent: "branch_create",
    worktree_intent: "worktree_create",
    dispatch_intent: "dispatch",
    collect_intent: "worker_collect",
    candidate_intent: "candidate_collect",
    verification_intent: "verify",
    reviewer_dispatch_intent: "review_dispatch",
    review_collect_intent: "review_collect",
    publish_intent: "publish",
    integrate_intent: "integrate",
    reservation_release_intent: "reservation_release",
    repair_intent: "repair",
    failure_intent: "failure",
    timeout_intent: "timeout",
    park_intent: "park",
    cancel_intent: "cancel"
  };
  const requiredActiveStates = /* @__PURE__ */ new Set([
    "dispatch_intent",
    "dispatched",
    "collect_intent",
    "repair_intent"
  ]);
  const optionallyActiveStates = /* @__PURE__ */ new Set([
    ...requiredActiveStates,
    "failure_intent",
    "timeout_intent",
    "cancel_intent",
    "park_intent"
  ]);
  for (const id of state.activeModifyingUnitIds) {
    if (state.units[id] === void 0)
      errors.push(`active modifying unit ${id} is unknown`);
    else if (!waveIds.has(id))
      errors.push(`active modifying unit ${id} is outside the current wave`);
  }
  const assignedSessions = /* @__PURE__ */ new Map();
  for (const [id, unit] of Object.entries(state.units)) {
    if (id !== unit.id)
      errors.push(`unit map key ${id} does not match unit id ${unit.id}`);
    if (unit.reservationIds.some(
      (reservationId) => state.reservations[reservationId]?.unitId !== unit.id
    ))
      errors.push(`unit ${id} claims an invalid reservation`);
    const unresolved = unresolvedByUnit.get(id) ?? [];
    if (unresolved.length > 0 && !waveIds.has(id))
      errors.push(
        `unit ${id} has unresolved evidence outside the current wave`
      );
    const expectedKind = intentByState[unit.state];
    if (unit.state === "blocked") {
      if (unresolved.length !== 1 || unresolved[0]?.status !== "ambiguous" || intentStateForEffect(unresolved[0]?.kind ?? "dispatch") === void 0)
        errors.push(`blocked unit ${id} lacks one exact ambiguous effect`);
    } else if (expectedKind !== void 0) {
      if (unresolved.length !== 1 || unresolved[0]?.kind !== expectedKind || unresolved[0]?.status !== "intended")
        errors.push(`intent state ${id} lacks one exact unresolved effect`);
    } else if (unresolved.length !== 0)
      errors.push(`stable unit ${id} has an orphan unresolved effect`);
    if (unit.reservationIds.length > 0 && unit.state !== "reservation_intent" && unit.state !== "reservation_release_intent" && unit.state !== "blocked" && unit.state !== "closed" && !unit.reservationIds.every(
      (reservationId) => state.reservations[reservationId]?.state === "reserved"
    ))
      errors.push(`reserved lifecycle ${id} lacks acquired reservations`);
    if (unit.state === "reservation_release_intent" && !unit.reservationIds.every(
      (reservationId) => state.reservations[reservationId]?.state === "release_intent"
    ))
      errors.push(`reservation cleanup ${id} lacks release intent`);
    if ([
      "branch_intent",
      "branch_observed",
      "worktree_intent",
      "worktree_observed"
    ].includes(unit.state) && unit.branchRef === void 0)
      errors.push(`branch lifecycle ${id} lacks branch ref`);
    if (["worktree_intent", "worktree_observed"].includes(unit.state) && unit.worktreePath === void 0)
      errors.push(`worktree lifecycle ${id} lacks worktree path`);
    if ([
      "dispatched",
      "collect_intent",
      "collected",
      "candidate_intent"
    ].includes(unit.state) && (unit.workerSessionId === void 0 || unit.workerPromptHash === void 0 || unit.workerRequestedModel === void 0 || unit.workerReturnedModel === void 0))
      errors.push(`worker lifecycle ${id} lacks bound session`);
    if ([
      "candidate_committed",
      "verification_intent",
      "qualified",
      "reviewer_dispatch_intent",
      "reviewer_dispatched",
      "review_collect_intent",
      "approved",
      "publish_intent",
      "published",
      "integrate_intent",
      "landed",
      "handoff"
    ].includes(unit.state) && (unit.candidateHead === void 0 || unit.candidateTree === void 0))
      errors.push(`candidate lifecycle ${id} lacks exact objects`);
    if ([
      "qualified",
      "reviewer_dispatch_intent",
      "reviewer_dispatched",
      "review_collect_intent",
      "approved",
      "publish_intent",
      "published",
      "integrate_intent",
      "landed",
      "handoff"
    ].includes(unit.state) && (unit.verificationBaseOid === void 0 || unit.verificationHeadOid === void 0 || unit.verificationTree === void 0 || unit.verificationEvidenceHash === void 0))
      errors.push(`qualification lifecycle ${id} lacks verification evidence`);
    if (unit.state === "verification_intent" && (unit.verificationCommands === void 0 || unit.verificationCommands.length === 0))
      errors.push(`verification intent ${id} lacks commands`);
    if (["reviewer_dispatched", "review_collect_intent"].includes(unit.state) && (unit.reviewerSessionId === void 0 || unit.reviewPromptHash === void 0 || unit.reviewerRequestedModel === void 0 || unit.reviewerReturnedModel === void 0))
      errors.push(`review lifecycle ${id} lacks bound session`);
    if ([
      "approved",
      "publish_intent",
      "published",
      "integrate_intent",
      "landed",
      "handoff"
    ].includes(unit.state) && (unit.reviewBaseOid === void 0 || unit.reviewHeadOid === void 0 || unit.reviewTree === void 0 || unit.approvalResponseHash === void 0))
      errors.push(`approval lifecycle ${id} lacks exact verdict`);
    if (["published", "handoff"].includes(unit.state) && unit.publishedHeadOid === void 0)
      errors.push(`published unit ${id} lacks remote-head readback`);
    if (state.completionBoundary === "pr-handoff" && unit.state === "handoff" && (unit.openPullRequest === void 0 || unit.openPullRequest.baseRef !== state.integrationBranch || unit.openPullRequest.baseOid !== unit.reviewBaseOid || unit.openPullRequest.remoteHeadOid !== unit.publishedHeadOid || unit.openPullRequest.remoteHeadOid !== unit.candidateHead))
      errors.push(
        `open-pr handoff ${id} lacks exact open pull-request evidence`
      );
    if (unit.openPullRequest !== void 0 && state.completionBoundary !== "pr-handoff")
      errors.push(
        `unit ${id} retains pull-request evidence outside open-pr authority`
      );
    if (unit.state === "landed" && unit.landedOid === void 0)
      errors.push(`landed ${id} lacks integration readback`);
    if (unit.state === "repair_required" && unit.repairContext === void 0)
      errors.push(`repair-required ${id} lacks retained repair context`);
    if (unit.workerSessionId !== void 0 && unit.workerSessionId === unit.reviewerSessionId)
      errors.push(`unit ${id} reuses one session for worker and reviewer`);
    for (const [role, session2] of [
      ["worker", unit.workerSessionId],
      ["reviewer", unit.reviewerSessionId]
    ]) {
      if (session2 === void 0) continue;
      if (!hasCurrentSessionLineage(session2, unit.ordinal, role))
        errors.push(`session ${session2} lacks exact durable lineage`);
      if (controllerIdentityMatches(state, session2))
        errors.push(`session ${session2} aliases controller identity`);
      const prior = assignedSessions.get(session2);
      if (prior !== void 0)
        errors.push(
          `session ${session2} is shared by ${prior} and ${id}/${role}`
        );
      else assignedSessions.set(session2, `${id}/${role}`);
    }
    const isActive = state.activeModifyingUnitIds.includes(id);
    const ambiguousKind = unresolved[0]?.status === "ambiguous" ? unresolved[0].kind : void 0;
    const allowedActive = optionallyActiveStates.has(unit.state) || unit.state === "blocked" && ambiguousKind !== void 0 && [
      "dispatch",
      "repair",
      "worker_collect",
      "failure",
      "timeout",
      "park",
      "cancel"
    ].includes(ambiguousKind);
    if (requiredActiveStates.has(unit.state) && !isActive || isActive && !allowedActive)
      errors.push(`active-session set disagrees with ${id}`);
  }
  for (const [id, reservation] of Object.entries(state.reservations)) {
    if (id !== reservation.id)
      errors.push(`reservation map key ${id} does not match reservation id`);
    if (state.units[reservation.unitId] === void 0)
      errors.push(`reservation ${id} has unknown owner`);
    const effectId = reservation.state === "released" ? reservation.releaseEffectId : reservation.acquireEffectId;
    const kind = reservation.state === "released" ? "reservation_release" : "reservation_acquire";
    if (["reserved", "released"].includes(reservation.state) && (effectId === void 0 || !state.effectJournal.some(
      (effect2) => effect2.effectId === effectId && effect2.unitId === reservation.unitId && effect2.kind === kind && effect2.status === "observed"
    )))
      errors.push(`reserved ${id} has no exact acquisition journal lineage`);
  }
  const controllerUnresolved = state.effectJournal.filter(
    (effect2) => effect2.unitId === null && (effect2.status === "intended" || effect2.status === "ambiguous")
  );
  const expectedControllerKind = state.controller.state === "acquire_intent" ? "controller_acquire" : state.controller.state === "release_intent" ? "controller_release" : void 0;
  if (expectedControllerKind === void 0 && controllerUnresolved.length !== 0 || expectedControllerKind !== void 0 && (controllerUnresolved.length !== 1 || controllerUnresolved[0]?.kind !== expectedControllerKind))
    errors.push("controller has an orphan or multiple unresolved effects");
  const qualificationQueueStates = /* @__PURE__ */ new Set([
    "candidate_committed",
    "verification_intent",
    "qualified",
    "reviewer_dispatch_intent",
    "reviewer_dispatched",
    "review_collect_intent",
    "approved",
    "publish_intent",
    "published",
    "integrate_intent"
  ]);
  const integrationQueueStates = /* @__PURE__ */ new Set([
    "approved",
    "publish_intent",
    "published",
    "integrate_intent"
  ]);
  const expectedQualificationQueue = Object.values(state.units).filter(
    (unit) => qualificationQueueStates.has(unit.state) || state.qualificationOwnerUnitId === unit.id && [
      "failure_intent",
      "timeout_intent",
      "park_intent",
      "cancel_intent"
    ].includes(unit.state)
  ).map((unit) => unit.id).sort();
  const expectedIntegrationQueue = Object.values(state.units).filter((unit) => integrationQueueStates.has(unit.state)).map((unit) => unit.id).sort();
  if (state.qualificationQueue.join("\0") !== expectedQualificationQueue.join("\0"))
    errors.push("qualification queue disagrees with unit state");
  if (state.integrationQueue.join("\0") !== expectedIntegrationQueue.join("\0"))
    errors.push("integration queue disagrees with unit state");
  const qualificationOwnerStates = /* @__PURE__ */ new Set([
    "verification_intent",
    "qualified",
    "reviewer_dispatch_intent",
    "reviewer_dispatched",
    "review_collect_intent",
    "approved",
    "publish_intent",
    "published",
    "integrate_intent"
  ]);
  const qualificationOwnerAllowedStates = /* @__PURE__ */ new Set([
    ...qualificationOwnerStates,
    // A terminal act begun while qualification/review owns the unit retains
    // that owner until its exact observation is recorded.
    "failure_intent",
    "timeout_intent",
    "park_intent",
    "cancel_intent"
  ]);
  if (state.qualificationOwnerUnitId !== void 0 && !qualificationOwnerAllowedStates.has(
    state.units[state.qualificationOwnerUnitId]?.state ?? "planned"
  ))
    errors.push("qualification owner is not qualifying");
  for (const unit of Object.values(state.units))
    if (qualificationOwnerStates.has(unit.state) && state.qualificationOwnerUnitId !== unit.id)
      errors.push(`qualifying unit ${unit.id} lacks owner converse`);
  if (state.qualificationOwnerUnitId !== void 0 && state.qualificationQueue[0] !== state.qualificationOwnerUnitId)
    errors.push("qualification owner is not queue head");
  if (state.integrationOwnerUnitId !== void 0 && state.units[state.integrationOwnerUnitId]?.state !== "integrate_intent")
    errors.push("integration owner is not integrating");
  for (const unit of Object.values(state.units))
    if (unit.state === "integrate_intent" && state.integrationOwnerUnitId !== unit.id)
      errors.push(
        `integrating unit ${unit.id} lacks integration owner converse`
      );
  if (state.integrationOwnerUnitId !== void 0 && state.integrationQueue[0] !== state.integrationOwnerUnitId)
    errors.push("integration owner is not queue head");
  const reviewerStates = /* @__PURE__ */ new Set([
    "reviewer_dispatch_intent",
    "reviewer_dispatched",
    "review_collect_intent"
  ]);
  const reviewerOwnerStates = /* @__PURE__ */ new Set([
    ...reviewerStates,
    "failure_intent",
    "timeout_intent",
    "park_intent",
    "cancel_intent"
  ]);
  if (state.currentReviewerUnitId !== void 0 && !reviewerOwnerStates.has(
    state.units[state.currentReviewerUnitId]?.state ?? "planned"
  ))
    errors.push("current reviewer is not active");
  for (const unit of Object.values(state.units))
    if (reviewerStates.has(unit.state) && state.currentReviewerUnitId !== unit.id)
      errors.push(`reviewer unit ${unit.id} lacks current reviewer converse`);
  if (state.currentReviewerUnitId !== void 0 && state.qualificationOwnerUnitId !== state.currentReviewerUnitId)
    errors.push("reviewer is not owned by qualification");
  if (state.state === "blocked" && controllerUnresolved.every((entry) => entry.status !== "ambiguous") && !Object.values(state.units).some((unit) => unit.state === "blocked"))
    errors.push("blocked aggregate lacks ambiguous durable evidence");
  if (state.state === "active" && state.controller.state !== "acquired")
    errors.push("active aggregate lacks controller ownership");
  if (state.state === "released" && state.controller.state !== "released")
    errors.push("released aggregate lacks controller release readback");
  if (state.controller.state === "released" && state.state !== "released")
    errors.push("released controller has non-released aggregate");
  return errors;
}
function illegal(unit, eventType) {
  return reject(
    "illegal_transition",
    `${eventType} is not legal while ${unit.id} is ${unit.state}`
  );
}
function reject(code, reason) {
  return { ok: false, code, reason };
}
function exhaustive(value) {
  throw new Error(`Unhandled protocol event: ${JSON.stringify(value)}`);
}

// src/protocol/actions.ts
function legalActions(stateInput) {
  const parsed = validate(RepositoryRunSchema, stateInput);
  if (!parsed.ok || parsed.value === void 0) return [];
  const state = parsed.value;
  if (runInvariantErrors(state).length > 0) return [];
  if (state.state === "released") return [];
  if (state.state === "blocked") return ambiguityRecoveryActions(state);
  const controllerActions = actionsForController(state);
  if (controllerActions !== void 0) return sortActions(controllerActions);
  if (state.controller.state !== "acquired") return [];
  return sortActions(
    Object.values(state.units).filter((unit) => state.wave.unitIds.includes(unit.id)).flatMap((unit) => actionsForUnit(state, unit)).filter(
      (action) => (action.mode !== "emit" || action.effectKind === void 0 || effectAllowed2(state, action.effectKind) && (action.unitId === void 0 || !hasUnresolvedUnitEffect2(state, action.unitId))) && (action.mode !== "record" || pendingUnitEffect(state, action))
    )
  );
}
var observationForEffect = {
  controller_acquire: "controller_acquired",
  reservation_acquire: "reservation_observed",
  branch_create: "branch_observed",
  worktree_create: "worktree_observed",
  dispatch: "dispatch_observed",
  worker_collect: "worker_collected",
  candidate_collect: "candidate_observed",
  verify: "verification_observed",
  review_dispatch: "reviewer_observed",
  review_collect: "review_collected",
  publish: "publish_observed",
  integrate: "integrate_observed",
  reservation_release: "reservation_released",
  repair: "repair_observed",
  failure: "failure_observed",
  timeout: "timeout_observed",
  park: "park_observed",
  cancel: "cancel_observed",
  controller_release: "controller_released"
};
function ambiguityRecoveryActions(state) {
  return sortActions(
    state.effectJournal.filter(
      (effect2) => effect2.status === "intended" || effect2.status === "ambiguous"
    ).map((effect2) => ({
      effectId: effect2.effectId,
      effectKind: effect2.kind,
      mode: "record",
      type: observationForEffect[effect2.kind],
      ...effect2.unitId === null ? {} : { unitId: effect2.unitId }
    }))
  );
}
function actionsForController(state) {
  if (state.controller.state === "unacquired") {
    return state.state === "initializing" ? [
      controllerAction(
        "controller_acquire_intent",
        "emit",
        "controller_acquire"
      )
    ] : [];
  }
  if (state.controller.state === "acquire_intent") {
    return (state.state === "initializing" || state.state === "blocked") && pendingControllerEffect(state, "controller_acquire") ? [
      controllerAction(
        "controller_acquired",
        "record",
        "controller_acquire"
      )
    ] : [];
  }
  if (state.controller.state === "release_intent") {
    return (state.state === "release_intent" || state.state === "blocked") && pendingControllerEffect(state, "controller_release") ? [
      controllerAction(
        "controller_released",
        "record",
        "controller_release"
      )
    ] : [];
  }
  if (state.controller.state === "released") return [];
  if (canReleaseController2(state))
    return [
      controllerAction(
        "controller_release_intent",
        "emit",
        "controller_release"
      )
    ];
  return void 0;
}
function controllerAction(type, mode, effectKind) {
  return { type, mode, effectKind };
}
function actionsForUnit(state, unit) {
  return [...lifecycleActions(state, unit), ...terminalIntents(unit)];
}
function lifecycleActions(state, unit) {
  switch (unit.state) {
    case "planned":
      return [
        unitAction(unit, "reservation_intent", "emit", "reservation_acquire")
      ];
    case "reservation_intent":
      return [
        unitAction(
          unit,
          "reservation_observed",
          "record",
          "reservation_acquire"
        )
      ];
    case "resources_reserved":
      return [unitAction(unit, "branch_intent", "emit", "branch_create")];
    case "branch_intent":
      return [unitAction(unit, "branch_observed", "record", "branch_create")];
    case "branch_observed":
      return [unitAction(unit, "worktree_intent", "emit", "worktree_create")];
    case "worktree_intent":
      return [
        unitAction(unit, "worktree_observed", "record", "worktree_create")
      ];
    case "worktree_observed":
      return state.activeModifyingUnitIds.length < 3 ? [unitAction(unit, "dispatch_intent", "emit", "dispatch")] : [];
    case "dispatch_intent":
      return [unitAction(unit, "dispatch_observed", "record", "dispatch")];
    case "dispatched":
      return [unitAction(unit, "collect_intent", "emit", "worker_collect")];
    case "collect_intent":
      return [unitAction(unit, "worker_collected", "record", "worker_collect")];
    case "collected":
      return [
        unitAction(unit, "candidate_intent", "emit", "candidate_collect")
      ];
    case "candidate_intent":
      return [
        unitAction(unit, "candidate_observed", "record", "candidate_collect")
      ];
    case "candidate_committed":
      return state.qualificationOwnerUnitId === void 0 && state.qualificationQueue[0] === unit.id ? [unitAction(unit, "verification_intent", "emit", "verify")] : [];
    case "verification_intent":
      return state.qualificationOwnerUnitId === unit.id ? [unitAction(unit, "verification_observed", "record", "verify")] : [];
    case "qualified":
      return state.qualificationOwnerUnitId === unit.id && state.currentReviewerUnitId === void 0 ? [
        unitAction(
          unit,
          "reviewer_dispatch_intent",
          "emit",
          "review_dispatch"
        )
      ] : [];
    case "reviewer_dispatch_intent":
      return state.currentReviewerUnitId === unit.id ? [unitAction(unit, "reviewer_observed", "record", "review_dispatch")] : [];
    case "reviewer_dispatched":
      return state.currentReviewerUnitId === unit.id ? [unitAction(unit, "review_collect_intent", "emit", "review_collect")] : [];
    case "review_collect_intent":
      return state.currentReviewerUnitId === unit.id ? [unitAction(unit, "review_collected", "record", "review_collect")] : [];
    case "approved":
      return isCurrentApproval2(unit) && state.qualificationOwnerUnitId === unit.id ? state.completionBoundary === "local-integration" ? [unitAction(unit, "integrate_intent", "emit", "integrate")] : [unitAction(unit, "publish_intent", "emit", "publish")] : [];
    case "publish_intent":
      return [unitAction(unit, "publish_observed", "record", "publish")];
    case "published":
      return hasCurrentApproval2(unit) && state.completionBoundary === "remote-integration" && state.qualificationOwnerUnitId === unit.id && (state.integrationOwnerUnitId === void 0 || state.integrationOwnerUnitId === unit.id) && state.integrationQueue[0] === unit.id ? [unitAction(unit, "integrate_intent", "emit", "integrate")] : [];
    case "integrate_intent":
      return state.integrationOwnerUnitId === unit.id ? [unitAction(unit, "integrate_observed", "record", "integrate")] : [];
    case "landed":
    case "handoff":
    case "cancelled":
    case "parked":
    case "failed":
    case "timed_out":
      return [
        ...repairIsEligible(state, unit) ? [unitAction(unit, "repair_intent", "emit", "repair")] : [],
        unitAction(
          unit,
          "reservation_release_intent",
          "emit",
          "reservation_release"
        )
      ];
    case "reservation_release_intent":
      return [
        unitAction(
          unit,
          "reservation_released",
          "record",
          "reservation_release"
        )
      ];
    case "repair_required":
      return repairIsEligible(state, unit) ? [unitAction(unit, "repair_intent", "emit", "repair")] : [];
    case "repair_intent":
      return [unitAction(unit, "repair_observed", "record", "repair")];
    case "failure_intent":
      return [unitAction(unit, "failure_observed", "record", "failure")];
    case "timeout_intent":
      return [unitAction(unit, "timeout_observed", "record", "timeout")];
    case "park_intent":
      return [unitAction(unit, "park_observed", "record", "park")];
    case "cancel_intent":
      return [unitAction(unit, "cancel_observed", "record", "cancel")];
    case "blocked":
    case "closed":
      return [];
  }
}
function terminalIntents(unit) {
  if (!canEnterTerminalIntent(unit.state)) return [];
  return [
    unitAction(unit, "failure_intent", "emit", "failure"),
    unitAction(unit, "timeout_intent", "emit", "timeout"),
    unitAction(unit, "park_intent", "emit", "park"),
    unitAction(unit, "cancel_intent", "emit", "cancel")
  ];
}
function unitAction(unit, type, mode, effectKind) {
  return { type, mode, unitId: unit.id, effectKind };
}
function repairIsEligible(state, unit) {
  return unit.repairContext !== void 0 && unit.branchRef !== void 0 && unit.worktreePath !== void 0 && (unit.repairContext.headOid === void 0 || unit.repairContext.headOid === unit.candidateHead) && unit.repairCount < 16 && state.activeModifyingUnitIds.length < 3;
}
function isCurrentApproval2(unit) {
  return unit.state === "approved" && unit.reviewBaseOid === unit.baseOid && unit.reviewHeadOid === unit.candidateHead && unit.reviewTree === unit.candidateTree && unit.approvalResponseHash !== void 0;
}
function hasCurrentApproval2(unit) {
  return unit.reviewBaseOid === unit.baseOid && unit.reviewHeadOid === unit.candidateHead && unit.reviewTree === unit.candidateTree && unit.approvalResponseHash !== void 0;
}
function canReleaseController2(state) {
  return state.controller.state === "acquired" && state.activeModifyingUnitIds.length === 0 && state.qualificationOwnerUnitId === void 0 && state.integrationOwnerUnitId === void 0 && state.currentReviewerUnitId === void 0 && Object.values(state.units).every((unit) => unit.state === "closed") && Object.values(state.reservations).every(
    (reservation) => reservation.state === "released"
  );
}
function effectAllowed2(state, kind) {
  if (kind === "publish")
    return state.completionBoundary === "branch-handoff" && state.authorityProfile !== "local-change-only" || state.completionBoundary === "pr-handoff" && ["open-pr", "integrate"].includes(state.authorityProfile) || state.completionBoundary === "remote-integration" && state.authorityProfile === "integrate";
  if (kind !== "integrate") return true;
  return state.completionBoundary === "local-integration" || state.completionBoundary === "remote-integration" && state.authorityProfile === "integrate";
}
function pendingUnitEffect(state, action) {
  return action.unitId !== void 0 && action.effectKind !== void 0 && state.effectJournal.some(
    (effect2) => effect2.unitId === action.unitId && effect2.kind === action.effectKind && (effect2.status === "intended" || effect2.status === "ambiguous")
  );
}
function hasUnresolvedUnitEffect2(state, unitId) {
  return state.effectJournal.some(
    (effect2) => effect2.unitId === unitId && (effect2.status === "intended" || effect2.status === "ambiguous")
  );
}
function pendingControllerEffect(state, kind) {
  return state.effectJournal.some(
    (effect2) => effect2.unitId === null && effect2.kind === kind && (effect2.status === "intended" || effect2.status === "ambiguous")
  );
}
function sortActions(actions) {
  return [...actions].sort((left, right) => {
    const leftKey = [
      left.type,
      left.unitId ?? "",
      left.mode,
      left.effectKind ?? "",
      left.effectId ?? ""
    ].join("\0");
    const rightKey = [
      right.type,
      right.unitId ?? "",
      right.mode,
      right.effectKind ?? "",
      right.effectId ?? ""
    ].join("\0");
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

// src/adapters/git/index.ts
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute as isAbsolute2,
  join,
  normalize as normalize2,
  relative,
  resolve as resolve2
} from "node:path";

// src/preflight/identity.ts
import { isAbsolute, normalize, resolve } from "node:path";

// src/preflight/schemas.ts
var import_ajv2 = __toESM(require_ajv(), 1);
var PREFLIGHT_SCHEMA = "sce.preflight";
var PREFLIGHT_VERSION = 1;
var BD_VERSION = "1.1.0";
var BD_CONTEXT_SCHEMA_VERSION = 1;
var MAX_PATH_BYTES = 4096;
var MAX_TEXT_BYTES = 8192;
var utf83 = new TextEncoder();
function strictObject2(properties) {
  return Type.Object(properties, { additionalProperties: false });
}
var text2 = (maxLength = MAX_TEXT_BYTES) => Type.String({ minLength: 1, maxLength, maxUtf8Bytes: maxLength });
var optionalText = (maxLength = MAX_TEXT_BYTES) => Type.Optional(text2(maxLength));
var absolutePath = () => Type.String({
  minLength: 1,
  maxLength: MAX_PATH_BYTES,
  maxUtf8Bytes: MAX_PATH_BYTES
});
var identifier2 = () => Type.String({
  minLength: 1,
  maxLength: 160,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
});
var ajv2 = new import_ajv2.Ajv({
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
  strict: true
});
ajv2.addKeyword({
  keyword: "maxUtf8Bytes",
  type: "string",
  schemaType: "number",
  validate: (limit, value) => utf83.encode(value).byteLength <= limit,
  errors: false
});
function isSchema(schema, value) {
  return ajv2.compile(schema)(value);
}
var InspectionCommandSchema = Type.Union([
  strictObject2({
    executable: Type.Literal("bd"),
    argv: Type.Tuple([Type.Literal("--version")])
  }),
  strictObject2({
    executable: Type.Literal("bd"),
    argv: Type.Tuple([
      Type.Literal("config"),
      Type.Literal("get"),
      Type.Literal("sync.remote"),
      Type.Literal("--json")
    ])
  }),
  strictObject2({
    executable: Type.Literal("bd"),
    argv: Type.Tuple([
      Type.Literal("config"),
      Type.Literal("get"),
      Type.Literal("issue_prefix"),
      Type.Literal("--json")
    ])
  }),
  strictObject2({
    executable: Type.Literal("bd"),
    argv: Type.Tuple([Type.Literal("context"), Type.Literal("--json")])
  }),
  strictObject2({
    executable: Type.Literal("bd"),
    argv: Type.Tuple([
      Type.Literal("dolt"),
      Type.Literal("show"),
      Type.Literal("--json")
    ])
  }),
  strictObject2({
    executable: Type.Literal("bd"),
    argv: Type.Tuple([
      Type.Literal("bootstrap"),
      Type.Literal("--dry-run"),
      Type.Literal("--json")
    ])
  }),
  strictObject2({
    executable: Type.Literal("git"),
    argv: Type.Tuple([
      Type.Literal("rev-parse"),
      Type.Literal("--show-toplevel")
    ])
  }),
  strictObject2({
    executable: Type.Literal("git"),
    argv: Type.Tuple([
      Type.Literal("rev-parse"),
      Type.Literal("--git-common-dir")
    ])
  }),
  strictObject2({
    executable: Type.Literal("git"),
    argv: Type.Tuple([
      Type.Literal("rev-parse"),
      Type.Literal("--show-object-format")
    ])
  }),
  strictObject2({
    executable: Type.Literal("git"),
    argv: Type.Tuple([
      Type.Literal("config"),
      Type.Literal("--null"),
      Type.Literal("--get-regexp"),
      Type.Literal("^remote\\..*\\.url$")
    ])
  })
]);
var SanitizedSubprocessRequestSchema = strictObject2({
  command: InspectionCommandSchema,
  cwd: absolutePath(),
  maxOutputBytes: Type.Integer({ minimum: 1, maximum: 65536 }),
  timeoutMs: Type.Integer({ minimum: 1, maximum: 15e3 })
});
var SanitizedSubprocessObservationSchema = strictObject2({
  command: Type.String({ minLength: 1, maxLength: 80 }),
  outcome: Type.Union([
    Type.Literal("ok"),
    Type.Literal("exit"),
    Type.Literal("signal"),
    Type.Literal("timeout"),
    Type.Literal("output_limit"),
    Type.Literal("unavailable")
  ]),
  exitCode: Type.Optional(Type.Integer({ minimum: 0, maximum: 255 })),
  signal: Type.Optional(
    Type.Union([
      Type.Literal("SIGINT"),
      Type.Literal("SIGTERM"),
      Type.Literal("SIGKILL"),
      Type.Literal("other")
    ])
  )
});
var BdContextObservationSchema = strictObject2({
  backend: Type.Union([
    Type.Literal("dolt"),
    Type.Literal("none"),
    Type.Literal("uninitialized")
  ]),
  bd_version: text2(32),
  beads_dir: Type.Optional(absolutePath()),
  cwd_repo_root: absolutePath(),
  database: Type.Optional(identifier2()),
  dolt_mode: Type.Optional(
    Type.Union([
      Type.Literal("embedded"),
      Type.Literal("shared-server"),
      Type.Literal("external"),
      Type.Literal("server"),
      Type.Literal("uninitialized"),
      Type.Literal("global"),
      Type.Literal("proxy")
    ])
  ),
  is_redirected: Type.Optional(Type.Boolean()),
  is_worktree: Type.Optional(Type.Boolean()),
  project_id: Type.Optional(identifier2()),
  repo_root: Type.Optional(absolutePath()),
  role: optionalText(80),
  schema_version: Type.Integer({
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER
  }),
  server: optionalText(320),
  server_source: Type.Optional(
    Type.Union([
      Type.Literal("shared-server"),
      Type.Literal("server"),
      Type.Literal("external"),
      Type.Literal("global"),
      Type.Literal("proxy")
    ])
  ),
  prefix: Type.Optional(identifier2()),
  rig: Type.Optional(identifier2()),
  sync_ref: Type.Optional(identifier2()),
  sync_remote: optionalText(1024),
  global: Type.Optional(Type.Boolean()),
  proxied: Type.Optional(Type.Boolean())
});
var BdDoltShowObservationSchema = strictObject2({
  backend: Type.Literal("dolt"),
  data_dir: absolutePath(),
  database: identifier2(),
  embedded: Type.Boolean(),
  schema_version: Type.Integer({
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER
  })
});
var BdConfigKeySchema = Type.Union([
  Type.Literal("sync.remote"),
  Type.Literal("issue_prefix")
]);
var BdConfigLocationSchema = Type.Union([
  Type.Literal("config.yaml"),
  Type.Literal("database")
]);
var BdConfigValueObservationSchema = strictObject2({
  key: BdConfigKeySchema,
  location: Type.Optional(BdConfigLocationSchema),
  schema_version: Type.Integer({
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER
  }),
  value: Type.String({
    minLength: 0,
    maxLength: 1024,
    maxUtf8Bytes: 1024
  })
});
var BootstrapActionSchema = Type.Union([
  Type.Literal("sync"),
  Type.Literal("create"),
  Type.Literal("clone"),
  Type.Literal("restore"),
  Type.Literal("import"),
  Type.Literal("validate")
]);
var BdBootstrapRawSchema = strictObject2({
  action: BootstrapActionSchema,
  beads_dir: Type.Optional(absolutePath()),
  database: Type.Optional(identifier2()),
  has_existing: Type.Boolean(),
  reason: text2(1024),
  schema_version: Type.Integer({
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER
  }),
  sync_remote: optionalText(1024)
});
var BootstrapPlanSchema = strictObject2({
  action: BootstrapActionSchema,
  beadsDir: Type.Optional(absolutePath()),
  database: Type.Optional(identifier2())
});
var DoltObservationSchema = strictObject2({
  autoCommit: Type.Union([
    Type.Literal("off"),
    Type.Literal("on"),
    Type.Literal("batch")
  ]),
  database: identifier2(),
  head: Type.Optional(
    Type.String({
      minLength: 40,
      maxLength: 64,
      pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$"
    })
  ),
  reachable: Type.Boolean(),
  workingSet: Type.Union([
    Type.Literal("clean"),
    Type.Literal("pending"),
    Type.Literal("unknown")
  ])
});
var GitInspectionSchema = strictObject2({
  commonDir: absolutePath(),
  objectFormat: Type.Union([Type.Literal("sha1"), Type.Literal("sha256")]),
  providerId: Type.Optional(identifier2()),
  remoteUrls: Type.Array(text2(1024), { minItems: 0, maxItems: 16 }),
  topLevel: absolutePath()
});
var BeadsIdentitySchema = strictObject2({
  beadsDir: Type.Optional(absolutePath()),
  contextSchemaVersion: Type.Literal(BD_CONTEXT_SCHEMA_VERSION),
  database: Type.Optional(identifier2()),
  mode: Type.Union([
    Type.Literal("embedded"),
    Type.Literal("managed_local_shared_server"),
    Type.Literal("external_server")
  ]),
  prefix: Type.Optional(identifier2()),
  projectId: Type.Optional(identifier2()),
  provenance: Type.Union([
    Type.Literal("embedded_config"),
    Type.Literal("shared_server_flag"),
    Type.Literal("external_server_flag")
  ]),
  rig: Type.Optional(identifier2()),
  server: Type.Optional(text2(320)),
  storePath: Type.Optional(absolutePath()),
  syncRef: Type.Optional(identifier2()),
  syncRemote: optionalText(1024),
  toolVersion: Type.Literal(BD_VERSION)
});
var GitIdentitySchema = strictObject2({
  commonDir: absolutePath(),
  identity: text2(1024),
  objectFormat: Type.Union([Type.Literal("sha1"), Type.Literal("sha256")]),
  topLevel: absolutePath()
});
var RefusalCodeSchema = Type.Union([
  Type.Literal("PF_BD_UNAVAILABLE"),
  Type.Literal("PF_BD_VERSION_UNSUPPORTED"),
  Type.Literal("PF_BD_CONTEXT_SCHEMA_UNSUPPORTED"),
  Type.Literal("PF_BD_CONTEXT_INVALID"),
  Type.Literal("PF_BD_CONFIG_INVALID"),
  Type.Literal("PF_TOPOLOGY_CONTRADICTORY"),
  Type.Literal("PF_TOPOLOGY_REFUSED"),
  Type.Literal("PF_BOOTSTRAP_PLAN_INVALID"),
  Type.Literal("PF_GIT_INSPECTION_INVALID"),
  Type.Literal("PF_GIT_IDENTITY_AMBIGUOUS"),
  Type.Literal("PF_SUBPROCESS_UNAVAILABLE"),
  Type.Literal("PF_SUBPROCESS_EXIT"),
  Type.Literal("PF_SUBPROCESS_SIGNAL"),
  Type.Literal("PF_SUBPROCESS_TIMEOUT"),
  Type.Literal("PF_SUBPROCESS_OUTPUT_LIMIT")
]);
var ReadyPreflightSchema = strictObject2({
  beads: BeadsIdentitySchema,
  git: GitIdentitySchema,
  status: Type.Literal("ready")
});
var UninitializedPreflightSchema = strictObject2({
  bootstrap: BootstrapPlanSchema,
  status: Type.Literal("uninitialized")
});
var RefusedPreflightSchema = strictObject2({
  code: RefusalCodeSchema,
  status: Type.Literal("refused")
});
var PreflightEnvelopeSchema = strictObject2({
  payload: Type.Union([
    ReadyPreflightSchema,
    UninitializedPreflightSchema,
    RefusedPreflightSchema
  ]),
  schema: Type.Literal(PREFLIGHT_SCHEMA),
  version: Type.Literal(PREFLIGHT_VERSION)
});
var secretKeyShape = /(?:^|[_.-])(?:api[_-]?(?:key|token)|authorization|bearer|cookie|credentials?|passwd|password|private[_-]?key|secret|session(?:[_-]?token)?|token)(?:$|[_.-])/iu;
var secretCanaryShape = /(?:^|[\s_-])(?:api[_-]?(?:key|token)|authorization|bearer|cookie|credentials?|passwd|password|private[_-]?key|secret|session(?:[_-]?token)?|token)[_-]?canary(?:$|[\s_-])/iu;
var secretAssignmentShape = /(?:^|[\s,{])(?:api[_-]?(?:key|token)|authorization|bearer|cookie|credentials?|passwd|password|private[_-]?key|secret|session(?:[_-]?token)?|token)\s*[:=]\s*[^\s,}]+/iu;
var credentialUrlShape = /https?:\/\/[^/?#\s@]+@/iu;
function containsSecretShape(value) {
  if (typeof value === "string")
    return secretCanaryShape.test(value) || secretAssignmentShape.test(value) || credentialUrlShape.test(value);
  if (Array.isArray(value)) return value.some(containsSecretShape);
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, nested]) => secretKeyShape.test(key) || containsSecretShape(nested)
  );
}

// src/preflight/identity.ts
function canonicalAbsolutePath(value) {
  if (value.includes("\0") || value.length === 0 || !isAbsolute(value) || containsSecretShape(value))
    return void 0;
  const canonical2 = normalize(resolve(value));
  return canonical2 === "/" ? void 0 : canonical2;
}
function canonicalRemotePath(value) {
  if (value.length === 0 || value.includes("\0") || containsSecretShape(value))
    return void 0;
  const withoutGitSuffix = value.replace(/\.git$/u, "");
  if (withoutGitSuffix.length === 0 || withoutGitSuffix.startsWith("/") || withoutGitSuffix.includes("//") || withoutGitSuffix.split("/").some((part) => part === "" || part === "." || part === ".."))
    return void 0;
  return withoutGitSuffix;
}
function canonicalLocalBarePath(path2, canonicalize) {
  const lexical = canonicalAbsolutePath(path2);
  if (lexical === void 0 || canonicalize === void 0) return void 0;
  const canonical2 = canonicalize(lexical);
  return canonical2 === void 0 ? void 0 : canonicalAbsolutePath(canonical2);
}
function decodeRemotePath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return void 0;
  }
}
function normalizeGitRemote(value, localBareCanonicalizer) {
  if (value !== value.trim() || value.length === 0 || containsSecretShape(value))
    return void 0;
  if (isAbsolute(value)) {
    if (!value.endsWith(".git")) return void 0;
    const path2 = canonicalLocalBarePath(value, localBareCanonicalizer);
    return path2 === void 0 ? void 0 : `local:${path2}`;
  }
  const shorthand = /^git@([A-Za-z0-9.-]+):(.+)$/u.exec(value);
  if (shorthand !== null) {
    const host = shorthand[1]?.toLowerCase();
    const path2 = shorthand[2] === void 0 ? void 0 : canonicalRemotePath(shorthand[2]);
    return host === void 0 || path2 === void 0 ? void 0 : `${host}/${path2}`;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return void 0;
  }
  if (parsed.password !== "" || parsed.search !== "" || parsed.hash !== "" || parsed.port !== "" || containsSecretShape(parsed.username))
    return void 0;
  if (parsed.protocol === "file:") {
    if (parsed.username !== "" || parsed.hostname !== "" && parsed.hostname !== "localhost")
      return void 0;
    if (!parsed.pathname.endsWith(".git")) return void 0;
    const decodedPath2 = decodeRemotePath(parsed.pathname);
    const path2 = decodedPath2 === void 0 ? void 0 : canonicalLocalBarePath(decodedPath2, localBareCanonicalizer);
    return path2 === void 0 ? void 0 : `local:${path2}`;
  }
  if (!["https:", "ssh:", "git+ssh:"].includes(parsed.protocol) || parsed.protocol !== "ssh:" && parsed.protocol !== "git+ssh:" && parsed.username !== "" || (parsed.protocol === "ssh:" || parsed.protocol === "git+ssh:") && parsed.username !== "git")
    return void 0;
  const decodedPath = decodeRemotePath(parsed.pathname);
  const remotePath = decodedPath === void 0 ? void 0 : canonicalRemotePath(decodedPath.replace(/^\/+/, ""));
  return remotePath === void 0 ? void 0 : `${parsed.hostname.toLowerCase()}/${remotePath}`;
}

// src/preflight/subprocess.ts
var remoteConfigKey = /^remote\.([A-Za-z0-9][A-Za-z0-9._-]*)\.url$/u;
var secretRemoteName = /(?:^|[_.-])(?:api[_-]?(?:key|token)|authorization|bearer|cookie|credentials?|passwd|password|private[_-]?key|secret|session[_-]?token|token)(?:$|[_.-])/iu;
function parseGitRemoteConfigOutput(source) {
  if (source.includes("\uFFFD") || !source.endsWith("\0")) return void 0;
  const records = source.slice(0, -1).split("\0");
  if (records.length === 0 || records.some((record2) => record2.length === 0))
    return void 0;
  const urls = [];
  for (const record2 of records) {
    const separator = record2.indexOf("\n");
    if (separator <= 0 || record2.indexOf("\n", separator + 1) !== -1)
      return void 0;
    const key = record2.slice(0, separator);
    const url = record2.slice(separator + 1);
    if (!remoteConfigKey.test(key) || secretRemoteName.test(key) || url.length === 0 || url.length > 1024 || /[\u0000\r\n\uFFFD]/u.test(url))
      return void 0;
    urls.push(url);
  }
  return urls;
}

// src/adapters/git/schemas.ts
var import_ajv3 = __toESM(require_ajv(), 1);
var utf84 = new TextEncoder();
var ajv3 = new import_ajv3.Ajv({
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  strict: true,
  useDefaults: false
});
ajv3.addKeyword({
  keyword: "maxUtf8Bytes",
  type: "string",
  schemaType: "number",
  validate: (limit, value) => utf84.encode(value).byteLength <= limit,
  errors: false
});
function strictObject3(properties) {
  return Type.Object(properties, { additionalProperties: false });
}
var oid2 = () => Type.String({
  minLength: 40,
  maxLength: 64,
  pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$"
});
var path = () => Type.String({ minLength: 1, maxLength: 4096, maxUtf8Bytes: 4096 });
var GitObjectFormatSchema2 = Type.Union([
  Type.Literal("sha1"),
  Type.Literal("sha256")
]);
var ProcessSignalSchema = Type.Union([
  Type.String({ minLength: 4, maxLength: 19, pattern: "^SIG[A-Z0-9]{1,16}$" }),
  Type.Null()
]);
var GitResultSchema = strictObject3({
  exitCode: Type.Union([
    Type.Integer({ minimum: 0, maximum: 255 }),
    Type.Null()
  ]),
  signal: ProcessSignalSchema,
  stdout: Type.String({ minLength: 0, maxLength: 65536, maxUtf8Bytes: 65536 }),
  timedOut: Type.Optional(Type.Boolean()),
  unavailable: Type.Optional(Type.Boolean())
});
var GitRepositorySchema = strictObject3({
  commonDir: path(),
  cwd: path(),
  identity: Type.String({ minLength: 1, maxLength: 1024, maxUtf8Bytes: 1024 }),
  objectFormat: GitObjectFormatSchema2,
  remoteUrls: Type.Array(
    Type.String({ minLength: 1, maxLength: 1024, maxUtf8Bytes: 1024 }),
    { maxItems: 16 }
  )
});
var GitSnapshotSchema = strictObject3({
  changedPaths: Type.Array(path(), { maxItems: 4096 }),
  clean: Type.Boolean(),
  head: oid2(),
  tree: oid2()
});
var GitEffectSchema = strictObject3({
  code: Type.Union([
    Type.Literal("GIT_OK"),
    Type.Literal("GIT_BAD_INPUT"),
    Type.Literal("GIT_COMMAND_FAILED"),
    Type.Literal("GIT_DIRTY"),
    Type.Literal("GIT_ABSENT"),
    Type.Literal("GIT_FOREIGN_BRANCH"),
    Type.Literal("GIT_FOREIGN_PUBLICATION"),
    Type.Literal("GIT_FOREIGN_WORKTREE"),
    Type.Literal("GIT_IDENTITY_MISMATCH"),
    Type.Literal("GIT_MOVED_BASE"),
    Type.Literal("GIT_NOT_FAST_FORWARD"),
    Type.Literal("GIT_REFUSED"),
    Type.Literal("GIT_REMOTE_AMBIGUOUS"),
    Type.Literal("GIT_REMOTE_MISSING"),
    Type.Literal("GIT_UNSUPPORTED_OBJECT_FORMAT"),
    Type.Literal("GIT_UNRESOLVED_EFFECT")
  ]),
  state: Type.Union([
    Type.Literal("observed"),
    Type.Literal("refused"),
    Type.Literal("ambiguous")
  ])
});
function isSchema2(schema, value) {
  return ajv3.compile(schema)(value);
}
function parseGitResult(value) {
  return isSchema2(GitResultSchema, value) ? value : void 0;
}

// src/adapters/git/index.ts
var OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
var REF = /^(?:[A-Za-z0-9][A-Za-z0-9._/-]*)(?:[A-Za-z0-9._/-])?$/u;
var REMOTE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
var PATH = /^[^\u0000\r\n]{1,4096}$/u;
var MAX_OUTPUT = 65536;
var activeHookPaths = /* @__PURE__ */ new Set();
function exactOid(format, value) {
  return OID.test(value) && value.length === (format === "sha1" ? 40 : 64);
}
function safeRef(value) {
  return REF.test(value) && !value.startsWith("/") && !value.endsWith("/") && !value.includes("//") && !value.includes("..") && !value.includes("@{") && !/[\\ ~^:?*\[\u0000-\u001f\u007f]/u.test(value) && value.split("/").every(
    (part) => part.length > 0 && !part.startsWith(".") && !part.endsWith(".") && !part.endsWith(".lock")
  );
}
function safePath(value) {
  return PATH.test(value) && !value.startsWith("-") && !value.includes("../");
}
function safeAbsolutePath(value) {
  return isAbsolute2(value) && safePath(value) && normalize2(resolve2(value)) !== "/";
}
function scopedHookPath(value) {
  if (!safeAbsolutePath(value)) return false;
  const root = normalize2(resolve2(tmpdir()));
  const candidate = normalize2(resolve2(value));
  const suffix = relative(root, candidate);
  return !isAbsolute2(suffix) && !suffix.startsWith("../") && suffix.startsWith("sce-git-pre-push-") && !suffix.includes("/") && activeHookPaths.has(candidate);
}
function allowedGitArgv(argv) {
  const [command, ...args] = argv;
  if (command === "rev-parse")
    return args.length === 1 && ["--git-common-dir", "--show-object-format"].includes(args[0] ?? "") || args.length === 2 && args[0] === "--verify" && ["HEAD^{commit}", "HEAD^{tree}"].includes(args[1] ?? "");
  if (command === "config")
    return args.length === 3 && args[0] === "--null" && args[1] === "--get-regexp" && args[2] === "^remote\\..*\\.url$";
  if (command === "for-each-ref")
    return args.length === 2 && args[0] === "--format=%(objectname)" && args[1]?.startsWith("refs/heads/") === true && safeRef(args[1].slice(11));
  if (command === "branch")
    return args.length === 2 && safeRef(args[0] ?? "") && OID.test(args[1] ?? "");
  if (command === "worktree")
    return args.length === 2 && args[0] === "list" && args[1] === "--porcelain" || args.length === 3 && args[0] === "add" && safeAbsolutePath(args[1] ?? "") && safeRef(args[2] ?? "");
  if (command === "status")
    return args.length === 2 && args[0] === "--porcelain=v1" && args[1] === "-z";
  if (command === "merge-base")
    return args.length === 3 && args[0] === "--is-ancestor" && OID.test(args[1] ?? "") && OID.test(args[2] ?? "");
  if (command === "diff")
    return args.length === 4 && args[0] === "--name-only" && args[1] === "-z" && args[2] === "--no-renames" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})\.\.(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(
      args[3] ?? ""
    );
  if (command === "symbolic-ref")
    return args.length === 2 && args[0] === "-q" && args[1] === "HEAD";
  if (command === "merge")
    return args.length === 2 && args[0] === "--ff-only" && OID.test(args[1] ?? "");
  if (command === "remote")
    return args.length === 4 && args[0] === "get-url" && args[1] === "--all" && args[2] === "--push" && REMOTE.test(args[3] ?? "");
  if (command === "ls-remote")
    return args.length === 4 && args[0] === "--refs" && args[1] === "--exit-code" && REMOTE.test(args[2] ?? "") && args[3]?.startsWith("refs/heads/") === true && safeRef(args[3].slice(11));
  if (command === "push") {
    const destination = /^([0-9a-f]{40}|[0-9a-f]{64}):refs\/heads\/(.+)$/u.exec(
      args[1] ?? ""
    );
    return args.length === 2 && REMOTE.test(args[0] ?? "") && destination !== null && safeRef(destination[2] ?? "");
  }
  if (command === "-c") {
    const hookPath = (args[0] ?? "").slice("core.hooksPath=".length);
    const destination = /^([0-9a-f]{40}|[0-9a-f]{64}):refs\/heads\/(.+)$/u.exec(
      args[3] ?? ""
    );
    return args.length === 4 && args[0]?.startsWith("core.hooksPath=") === true && scopedHookPath(hookPath) && args[1] === "push" && REMOTE.test(args[2] ?? "") && destination !== null && safeRef(destination[2] ?? "");
  }
  return false;
}
function canonicalWorktreePath(value) {
  if (!safeAbsolutePath(value)) return void 0;
  try {
    return normalize2(realpathSync(value));
  } catch {
    try {
      return join(normalize2(realpathSync(dirname(value))), basename(value));
    } catch {
      return void 0;
    }
  }
}
function canonicalExistingOrLexical(value) {
  try {
    return normalize2(realpathSync(value));
  } catch {
    return normalize2(resolve2(value));
  }
}
function effect(state, code) {
  return { code, state };
}
function commandOk(result2) {
  return result2.exitCode === 0 && result2.signal === null && result2.timedOut !== true && result2.unavailable !== true && Buffer.byteLength(result2.stdout, "utf8") <= MAX_OUTPUT;
}
function terminalFailure(result2) {
  if (result2.timedOut === true || result2.signal !== null)
    return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  if (result2.unavailable === true)
    return effect("refused", "GIT_COMMAND_FAILED");
  if (Buffer.byteLength(result2.stdout, "utf8") > MAX_OUTPUT)
    return effect("refused", "GIT_COMMAND_FAILED");
  return void 0;
}
function lines(value) {
  if (value.includes("\0") || value.length > MAX_OUTPUT) return void 0;
  const output = value.trimEnd();
  if (output.length === 0) return [];
  const result2 = output.split("\n");
  return result2.some((line) => line.length === 0 || line.includes("\r")) ? void 0 : result2;
}
function oneLine(value) {
  const result2 = lines(value);
  return result2?.length === 1 ? result2[0] : void 0;
}
function outputResult(result2) {
  return terminalFailure(result2) ?? (commandOk(result2) ? void 0 : effect("refused", "GIT_COMMAND_FAILED"));
}
function validRepository(repository) {
  return safeAbsolutePath(repository.cwd) && safeAbsolutePath(repository.commonDir) && repository.identity.length > 0 && repository.identity.length <= 1024 && !repository.identity.includes("\0") && repository.remoteUrls.length <= 16 && repository.remoteUrls.every(
    (url) => url.length > 0 && url.length <= 1024 && !url.includes("\0")
  ) && (repository.objectFormat === "sha1" || repository.objectFormat === "sha256");
}
function localIdentity(repository) {
  return `local:${canonicalExistingOrLexical(repository.commonDir)}`;
}
function canonicalRemoteAliases(urls) {
  const aliases = urls.map(
    (url) => normalizeGitRemote(url, (path2) => canonicalGitCommonDir(path2))
  );
  return aliases.some((alias) => alias === void 0) ? void 0 : [...new Set(aliases)].sort();
}
async function run(runner, repository, argv) {
  try {
    const observed2 = parseGitResult(
      await runner({ argv, cwd: repository.cwd })
    );
    return observed2 ?? {
      exitCode: null,
      signal: null,
      stdout: "",
      unavailable: true
    };
  } catch {
    return { exitCode: null, signal: null, stdout: "", unavailable: true };
  }
}
async function runAt(runner, cwd, argv) {
  try {
    const observed2 = parseGitResult(await runner({ argv, cwd }));
    return observed2 ?? {
      exitCode: null,
      signal: null,
      stdout: "",
      unavailable: true
    };
  } catch {
    return { exitCode: null, signal: null, stdout: "", unavailable: true };
  }
}
async function refOid(runner, repository, ref) {
  const result2 = await run(runner, repository, [
    "for-each-ref",
    "--format=%(objectname)",
    ref
  ]);
  if (terminalFailure(result2) !== void 0) return { state: "unreadable" };
  if (!commandOk(result2)) return { state: "unreadable" };
  if (result2.stdout.length === 0) return { state: "missing" };
  const value = oneLine(result2.stdout);
  return value !== void 0 && exactOid(repository.objectFormat, value) ? { state: "found", oid: value } : { state: "unreadable" };
}
async function remoteRefOid(runner, repository, remote2, ref) {
  const result2 = await run(runner, repository, [
    "ls-remote",
    "--refs",
    "--exit-code",
    remote2,
    ref
  ]);
  if (terminalFailure(result2) !== void 0) return { state: "unreadable" };
  if (result2.exitCode === 2 && result2.signal === null)
    return { state: "missing" };
  if (!commandOk(result2)) return { state: "unreadable" };
  const record2 = oneLine(result2.stdout);
  if (record2 === void 0) return { state: "unreadable" };
  const fields = record2.split("	");
  return fields.length === 2 && fields[0] !== void 0 && fields[1] === ref && exactOid(repository.objectFormat, fields[0]) ? { state: "found", oid: fields[0] } : { state: "unreadable" };
}
async function verifyWorktreeOwnership(runner, repository, path2) {
  const result2 = await runAt(runner, path2, ["rev-parse", "--git-common-dir"]);
  const failure2 = outputResult(result2);
  if (failure2 !== void 0) return effect("refused", "GIT_FOREIGN_WORKTREE");
  const observed2 = oneLine(result2.stdout);
  if (observed2 === void 0 || !safePath(observed2))
    return effect("refused", "GIT_FOREIGN_WORKTREE");
  const commonDir = isAbsolute2(observed2) ? normalize2(resolve2(observed2)) : normalize2(resolve2(path2, observed2));
  return canonicalExistingOrLexical(commonDir) === canonicalExistingOrLexical(repository.commonDir) ? effect("observed", "GIT_OK") : effect("refused", "GIT_FOREIGN_WORKTREE");
}
async function verifyCleanWorktree(runner, repository, path2) {
  const ownership = await verifyWorktreeOwnership(runner, repository, path2);
  if (ownership.state !== "observed") return ownership;
  const status = await runAt(runner, path2, ["status", "--porcelain=v1", "-z"]);
  if (!commandOk(status)) return effect("refused", "GIT_FOREIGN_WORKTREE");
  return status.stdout.length === 0 ? effect("observed", "GIT_OK") : effect("refused", "GIT_DIRTY");
}
async function verifySinglePushRemote(runner, repository, remote2) {
  const result2 = await run(runner, repository, [
    "remote",
    "get-url",
    "--all",
    "--push",
    remote2
  ]);
  const failure2 = outputResult(result2);
  if (failure2 !== void 0) return effect("refused", "GIT_REMOTE_AMBIGUOUS");
  const urls = lines(result2.stdout);
  if (urls?.length !== 1 || urls[0] === void 0 || /(?:^|[/:@])(?:token|password|secret|bearer|authorization)(?:[=:]|$)/iu.test(
    urls[0]
  ))
    return effect("refused", "GIT_REMOTE_AMBIGUOUS");
  const expectedAliases = canonicalRemoteAliases(repository.remoteUrls);
  const pushAliases = canonicalRemoteAliases(urls);
  if (expectedAliases === void 0 || pushAliases === void 0 || pushAliases.length !== 1 || !expectedAliases.includes(pushAliases[0] ?? ""))
    return effect("refused", "GIT_REMOTE_AMBIGUOUS");
  return effect("observed", "GIT_OK");
}
async function guardedPush(runner, repository, input) {
  let directory;
  try {
    directory = await mkdtemp(join(tmpdir(), "sce-git-pre-push-"));
    const hook = join(directory, "pre-push");
    await writeFile(
      hook,
      `#!/bin/sh
IFS=' '
read -r local_ref local_oid remote_ref remote_oid || exit 1
[ "$local_oid" = '${input.candidate}' ] || exit 1
[ "$remote_ref" = '${input.ref}' ] || exit 1
[ "$remote_oid" = '${input.base}' ] || exit 1
exit 0
`,
      { encoding: "utf8", mode: 448 }
    );
    await chmod(hook, 448);
    activeHookPaths.add(normalize2(resolve2(directory)));
    return await run(runner, repository, [
      "-c",
      `core.hooksPath=${directory}`,
      "push",
      input.remote,
      `${input.candidate}:${input.ref}`
    ]);
  } catch {
    return { exitCode: null, signal: null, stdout: "", unavailable: true };
  } finally {
    if (directory !== void 0) {
      activeHookPaths.delete(normalize2(resolve2(directory)));
      await rm(directory, { force: true, recursive: true }).catch(
        () => void 0
      );
    }
  }
}
async function verifyRepository(runner, repository) {
  if (!validRepository(repository)) return effect("refused", "GIT_BAD_INPUT");
  const [common, format, remotes] = await Promise.all([
    run(runner, repository, ["rev-parse", "--git-common-dir"]),
    run(runner, repository, ["rev-parse", "--show-object-format"]),
    run(runner, repository, [
      "config",
      "--null",
      "--get-regexp",
      "^remote\\..*\\.url$"
    ])
  ]);
  const failure2 = terminalFailure(common) ?? terminalFailure(format) ?? terminalFailure(remotes);
  if (failure2 !== void 0) return failure2;
  if (!commandOk(common) || !commandOk(format))
    return effect("refused", "GIT_COMMAND_FAILED");
  const commonDir = oneLine(common.stdout);
  const objectFormat = oneLine(format.stdout);
  if (commonDir === void 0 || objectFormat === void 0 || !safePath(commonDir) || objectFormat !== repository.objectFormat)
    return effect("refused", "GIT_UNSUPPORTED_OBJECT_FORMAT");
  const canonicalCommon = isAbsolute2(commonDir) ? normalize2(resolve2(commonDir)) : normalize2(resolve2(repository.cwd, commonDir));
  if (canonicalExistingOrLexical(canonicalCommon) !== canonicalExistingOrLexical(repository.commonDir))
    return effect("refused", "GIT_IDENTITY_MISMATCH");
  const noConfiguredRemotes = remotes.exitCode === 1 && remotes.signal === null && remotes.stdout.length === 0;
  if (!commandOk(remotes) && !noConfiguredRemotes)
    return effect("refused", "GIT_COMMAND_FAILED");
  const actualUrls = noConfiguredRemotes ? [] : parseGitRemoteConfigOutput(remotes.stdout);
  const expectedAliases = canonicalRemoteAliases(repository.remoteUrls);
  const actualAliases = actualUrls === void 0 ? void 0 : canonicalRemoteAliases(actualUrls);
  if (expectedAliases === void 0 || actualAliases === void 0 || expectedAliases.length !== actualAliases.length || expectedAliases.some((alias, index) => alias !== actualAliases[index]))
    return effect("refused", "GIT_IDENTITY_MISMATCH");
  if (actualAliases.length === 0 && repository.identity !== localIdentity(repository))
    return effect("refused", "GIT_IDENTITY_MISMATCH");
  if (actualAliases.length > 0 && !repository.identity.startsWith("provider:") && (actualAliases.length !== 1 || actualAliases[0] !== repository.identity))
    return effect("refused", "GIT_IDENTITY_MISMATCH");
  return effect("observed", "GIT_OK");
}
async function ensureBranch(runner, repository, input) {
  if (!safeRef(input.branch) || !exactOid(repository.objectFormat, input.base))
    return effect("refused", "GIT_BAD_INPUT");
  const verified = await verifyRepository(runner, repository);
  if (verified.state !== "observed") return verified;
  const ref = `refs/heads/${input.branch}`;
  const before = await refOid(runner, repository, ref);
  if (before.state === "found" && before.oid === input.base)
    return effect("observed", "GIT_OK");
  if (before.state !== "missing") return effect("refused", "GIT_REFUSED");
  const created = await run(runner, repository, [
    "branch",
    input.branch,
    input.base
  ]);
  const after = await refOid(runner, repository, ref);
  if (after.state === "found" && after.oid === input.base)
    return effect("observed", "GIT_OK");
  if (after.state === "unreadable" || terminalFailure(created) !== void 0)
    return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  return created.exitCode === 0 ? effect("ambiguous", "GIT_UNRESOLVED_EFFECT") : effect("refused", "GIT_REFUSED");
}
async function discoverBranch(runner, repository, input) {
  if (!safeRef(input.branch) || !exactOid(repository.objectFormat, input.base))
    return effect("refused", "GIT_BAD_INPUT");
  const verified = await verifyRepository(runner, repository);
  if (verified.state !== "observed") return verified;
  const current = await refOid(
    runner,
    repository,
    `refs/heads/${input.branch}`
  );
  if (current.state === "unreadable")
    return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  if (current.state === "missing") return effect("refused", "GIT_ABSENT");
  return current.oid === input.base ? effect("observed", "GIT_OK") : effect("refused", "GIT_FOREIGN_BRANCH");
}
function parseWorktreeList(source, format) {
  const blocks = source.trimEnd().split("\n\n");
  if (blocks.length === 0 || blocks.some((block) => block.length === 0))
    return void 0;
  const records = [];
  for (const block of blocks) {
    const fields = /* @__PURE__ */ new Map();
    for (const line of block.split("\n")) {
      const position = line.indexOf(" ");
      if (position === -1) {
        if (!["bare", "detached", "locked", "prunable"].includes(line))
          return void 0;
        if (fields.has(line)) return void 0;
        fields.set(line, "");
        continue;
      }
      if (position < 1 || fields.has(line.slice(0, position))) return void 0;
      if (!["worktree", "HEAD", "branch", "locked", "prunable"].includes(
        line.slice(0, position)
      ))
        return void 0;
      fields.set(line.slice(0, position), line.slice(position + 1));
    }
    const path2 = fields.get("worktree");
    const head3 = fields.get("HEAD");
    const branch = fields.get("branch");
    if (path2 === void 0 || !safeAbsolutePath(path2) || head3 !== void 0 && !exactOid(format, head3) || branch !== void 0 && (!branch.startsWith("refs/heads/") || !safeRef(branch.slice(11))))
      return void 0;
    records.push({
      ...branch === void 0 ? {} : { branch },
      ...head3 === void 0 ? {} : { head: head3 },
      path: path2
    });
  }
  return records;
}
async function ensureWorktree(runner, repository, input) {
  if (!safeRef(input.branch) || !exactOid(repository.objectFormat, input.head) || !safeAbsolutePath(input.path))
    return effect("refused", "GIT_BAD_INPUT");
  const verified = await verifyRepository(runner, repository);
  if (verified.state !== "observed") return verified;
  const listed = await run(runner, repository, [
    "worktree",
    "list",
    "--porcelain"
  ]);
  const listFailure = outputResult(listed);
  if (listFailure !== void 0) return listFailure;
  const records = parseWorktreeList(listed.stdout, repository.objectFormat);
  if (records === void 0) return effect("refused", "GIT_REFUSED");
  const wantedPath = canonicalWorktreePath(input.path);
  if (wantedPath === void 0) return effect("refused", "GIT_BAD_INPUT");
  const existing = records.find((record2) => record2.path === wantedPath);
  const wantedBranch = `refs/heads/${input.branch}`;
  if (existing !== void 0)
    return existing.head === input.head && existing.branch === wantedBranch ? verifyCleanWorktree(runner, repository, input.path) : effect("refused", "GIT_FOREIGN_WORKTREE");
  if (records.some((record2) => record2.branch === wantedBranch))
    return effect("refused", "GIT_FOREIGN_WORKTREE");
  const added = await run(runner, repository, [
    "worktree",
    "add",
    input.path,
    input.branch
  ]);
  const reread = await run(runner, repository, [
    "worktree",
    "list",
    "--porcelain"
  ]);
  if (!commandOk(reread)) return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  const discovered2 = parseWorktreeList(
    reread.stdout,
    repository.objectFormat
  )?.find((record2) => record2.path === wantedPath);
  if (discovered2?.head !== input.head || discovered2.branch !== wantedBranch)
    return terminalFailure(added) === void 0 && added.exitCode !== 0 ? effect("refused", "GIT_REFUSED") : effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  return verifyCleanWorktree(runner, repository, input.path);
}
async function discoverWorktree(runner, repository, input) {
  if (!safeRef(input.branch) || !exactOid(repository.objectFormat, input.head) || !safeAbsolutePath(input.path))
    return effect("refused", "GIT_BAD_INPUT");
  const verified = await verifyRepository(runner, repository);
  if (verified.state !== "observed") return verified;
  const listed = await run(runner, repository, [
    "worktree",
    "list",
    "--porcelain"
  ]);
  const failure2 = outputResult(listed);
  if (failure2 !== void 0) return failure2;
  const records = parseWorktreeList(listed.stdout, repository.objectFormat);
  const wantedPath = canonicalWorktreePath(input.path);
  if (records === void 0 || wantedPath === void 0)
    return effect("refused", "GIT_REFUSED");
  const existing = records.find((record2) => record2.path === wantedPath);
  if (existing === void 0) return effect("refused", "GIT_ABSENT");
  return existing.head === input.head && existing.branch === `refs/heads/${input.branch}` ? verifyCleanWorktree(runner, repository, input.path) : effect("refused", "GIT_FOREIGN_WORKTREE");
}
async function discoverIntegration(runner, repository, input) {
  if (!safeRef(input.integrationRef) || !exactOid(repository.objectFormat, input.candidate))
    return effect("refused", "GIT_BAD_INPUT");
  const verified = await verifyRepository(runner, repository);
  if (verified.state !== "observed") return verified;
  const current = await refOid(runner, repository, input.integrationRef);
  if (current.state === "unreadable")
    return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  return current.state === "found" && current.oid === input.candidate ? effect("observed", "GIT_OK") : effect("refused", "GIT_NOT_FAST_FORWARD");
}
async function integrateLocalFastForward(runner, repository, input) {
  if (!safeRef(input.integrationRef) || !exactOid(repository.objectFormat, input.base) || !exactOid(repository.objectFormat, input.candidate))
    return effect("refused", "GIT_BAD_INPUT");
  const verified = await verifyRepository(runner, repository);
  if (verified.state !== "observed") return verified;
  const before = await refOid(runner, repository, input.integrationRef);
  if (before.state !== "found" || before.oid !== input.base)
    return effect("refused", "GIT_MOVED_BASE");
  const headRef = await run(runner, repository, ["symbolic-ref", "-q", "HEAD"]);
  if (!commandOk(headRef) || oneLine(headRef.stdout) !== input.integrationRef)
    return effect("refused", "GIT_FOREIGN_WORKTREE");
  const clean = await run(runner, repository, [
    "status",
    "--porcelain=v1",
    "-z"
  ]);
  if (!commandOk(clean) || clean.stdout.length !== 0)
    return effect("refused", "GIT_DIRTY");
  const merged = await run(runner, repository, [
    "merge",
    "--ff-only",
    input.candidate
  ]);
  const after = await refOid(runner, repository, input.integrationRef);
  if (after.state === "found" && after.oid === input.candidate)
    return effect("observed", "GIT_OK");
  if (after.state === "unreadable" || terminalFailure(merged) !== void 0)
    return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  return merged.exitCode === 0 ? effect("ambiguous", "GIT_UNRESOLVED_EFFECT") : effect("refused", "GIT_NOT_FAST_FORWARD");
}
async function publishCandidate(runner, repository, input) {
  if (!REMOTE.test(input.remote) || !safeRef(input.remoteBranch) || !exactOid(repository.objectFormat, input.candidate))
    return effect("refused", "GIT_BAD_INPUT");
  const verified = await verifyRepository(runner, repository);
  if (verified.state !== "observed") return verified;
  const remoteVerified = await verifySinglePushRemote(
    runner,
    repository,
    input.remote
  );
  if (remoteVerified.state !== "observed") return remoteVerified;
  const pushed = await run(runner, repository, [
    "push",
    input.remote,
    `${input.candidate}:refs/heads/${input.remoteBranch}`
  ]);
  const remote2 = await remoteRefOid(
    runner,
    repository,
    input.remote,
    `refs/heads/${input.remoteBranch}`
  );
  if (remote2.state === "found" && remote2.oid === input.candidate)
    return effect("observed", "GIT_OK");
  if (remote2.state === "unreadable" || terminalFailure(pushed) !== void 0)
    return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
}
async function discoverPublication(runner, repository, input) {
  if (!REMOTE.test(input.remote) || !safeRef(input.remoteBranch) || !exactOid(repository.objectFormat, input.candidate))
    return effect("refused", "GIT_BAD_INPUT");
  const verified = await verifyRepository(runner, repository);
  if (verified.state !== "observed") return verified;
  const remoteVerified = await verifySinglePushRemote(
    runner,
    repository,
    input.remote
  );
  if (remoteVerified.state !== "observed") return remoteVerified;
  const current = await remoteRefOid(
    runner,
    repository,
    input.remote,
    `refs/heads/${input.remoteBranch}`
  );
  if (current.state === "unreadable")
    return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  if (current.state === "missing") return effect("refused", "GIT_ABSENT");
  return current.oid === input.candidate ? effect("observed", "GIT_OK") : effect("refused", "GIT_FOREIGN_PUBLICATION");
}
async function integrateRemoteFastForward(runner, repository, input) {
  if (!REMOTE.test(input.remote) || !safeRef(input.integrationBranch) || !exactOid(repository.objectFormat, input.base) || !exactOid(repository.objectFormat, input.candidate))
    return effect("refused", "GIT_BAD_INPUT");
  const verified = await verifyRepository(runner, repository);
  if (verified.state !== "observed") return verified;
  const remoteVerified = await verifySinglePushRemote(
    runner,
    repository,
    input.remote
  );
  if (remoteVerified.state !== "observed") return remoteVerified;
  const ref = `refs/heads/${input.integrationBranch}`;
  const before = await remoteRefOid(runner, repository, input.remote, ref);
  if (before.state === "unreadable")
    return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  if (before.state === "found" && before.oid === input.candidate)
    return effect("observed", "GIT_OK");
  if (before.state === "missing")
    return effect("refused", "GIT_REMOTE_MISSING");
  if (before.oid !== input.base) return effect("refused", "GIT_MOVED_BASE");
  const pushed = await guardedPush(runner, repository, {
    base: input.base,
    candidate: input.candidate,
    ref,
    remote: input.remote
  });
  const after = await remoteRefOid(runner, repository, input.remote, ref);
  if (after.state === "unreadable")
    return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  if (after.state === "found" && after.oid === input.candidate)
    return effect("observed", "GIT_OK");
  if (after.state === "found" && after.oid !== input.base)
    return effect("refused", "GIT_MOVED_BASE");
  if (after.state === "missing" || terminalFailure(pushed) !== void 0)
    return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  if (pushed.exitCode !== 0) return effect("refused", "GIT_NOT_FAST_FORWARD");
  return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
}
async function discoverRemoteIntegration(runner, repository, input) {
  if (!REMOTE.test(input.remote) || !safeRef(input.integrationBranch) || !exactOid(repository.objectFormat, input.candidate))
    return effect("refused", "GIT_BAD_INPUT");
  const verified = await verifyRepository(runner, repository);
  if (verified.state !== "observed") return verified;
  const remoteVerified = await verifySinglePushRemote(
    runner,
    repository,
    input.remote
  );
  if (remoteVerified.state !== "observed") return remoteVerified;
  const observed2 = await remoteRefOid(
    runner,
    repository,
    input.remote,
    `refs/heads/${input.integrationBranch}`
  );
  if (observed2.state === "unreadable")
    return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  if (observed2.state === "missing")
    return effect("refused", "GIT_REMOTE_MISSING");
  return observed2.oid === input.candidate ? effect("observed", "GIT_OK") : effect("refused", "GIT_MOVED_BASE");
}
var nodeGitRunner = async ({ argv, cwd }) => {
  if (!safeAbsolutePath(cwd) || !allowedGitArgv(argv))
    return { exitCode: null, signal: null, stdout: "", unavailable: true };
  return new Promise((done) => {
    let stdout = "";
    let outputBytes = 0;
    let timedOut = false;
    let unavailable3 = false;
    const child = spawn("/usr/bin/git", argv, {
      cwd,
      env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin", TZ: "UTC" },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    const consume = (isStdout, chunk) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_OUTPUT) child.kill("SIGKILL");
      else if (isStdout) stdout += chunk.toString("utf8");
    };
    child.stdout.on("data", (chunk) => consume(true, chunk));
    child.stderr.on("data", (chunk) => consume(false, chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 15e3);
    child.once("error", () => {
      unavailable3 = true;
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      done({ exitCode, signal, stdout, timedOut, unavailable: unavailable3 });
    });
  });
};
function canonicalGitCommonDir(path2) {
  if (!safeAbsolutePath(path2)) return void 0;
  try {
    const canonical2 = realpathSync(path2);
    return safeAbsolutePath(canonical2) ? canonical2 : void 0;
  } catch {
    return void 0;
  }
}

// src/fencing/schemas.ts
var FENCING_SCHEMA_VERSION = 1;
var MERGE_SLOT_LABEL = "gt:slot";
var MERGE_SLOT_TITLE = "Merge Slot";
var FENCING_LIMITS = {
  batchBytes: 262144,
  childProjectionBytes: 65536,
  changedRows: 64,
  projectionBytes: 196608
};
var identifier3 = () => Type.String({
  minLength: 1,
  maxLength: 160,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
});
var holder = () => Type.String({
  minLength: 3,
  maxLength: 321,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$"
});
var hash2 = () => Type.String({ minLength: 64, maxLength: 64, pattern: "^[0-9a-f]{64}$" });
var revision2 = () => Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
var FencingScopeSchema = strictObject({
  beadsStoreIdentity: identifier3(),
  gitRepositoryIdentity: identifier3(),
  integrationBranch: identifier3()
});
var ChildRowReferenceSchema = strictObject({
  commitment: hash2(),
  revision: revision2(),
  unitId: identifier3()
});
var CheckpointObservationSchema = strictObject({
  aggregateRevision: revision2(),
  changedRowsCommitment: hash2(),
  rootCommitment: hash2()
});
var RootProjectionSchema = strictObject({
  aggregateCommitment: hash2(),
  aggregateRevision: revision2(),
  checkpoint: CheckpointObservationSchema,
  childRows: Type.Array(ChildRowReferenceSchema, {
    maxItems: FENCING_LIMITS.changedRows
  }),
  holder: holder(),
  run: RepositoryRunSchema,
  schema: Type.Literal("sce.fencing.root"),
  scope: FencingScopeSchema,
  version: Type.Literal(FENCING_SCHEMA_VERSION)
});
var ChildProjectionSchema = strictObject({
  commitment: hash2(),
  holder: holder(),
  revision: revision2(),
  schema: Type.Literal("sce.fencing.child"),
  scope: FencingScopeSchema,
  unit: UnitSchema,
  unitId: identifier3(),
  version: Type.Literal(FENCING_SCHEMA_VERSION)
});
var ExpectedChildRowSchema = strictObject({
  expectedCommitment: hash2(),
  expectedRevision: revision2(),
  unitId: identifier3()
});
var ChangedRowSchema = strictObject({
  expectedCommitment: hash2(),
  expectedRevision: revision2(),
  nextCommitment: hash2(),
  nextRevision: revision2(),
  unitId: identifier3()
});
var ContinuationEvidenceSchema = strictObject({
  nextHolder: holder(),
  observationHash: hash2(),
  previousHolder: holder(),
  scopeCommitment: hash2()
});
var ReleaseEvidenceSchema = strictObject({
  available: Type.Literal(true),
  holder: holder(),
  observationHash: hash2(),
  scopeCommitment: hash2()
});
var MergeSlotObservationSchema = strictObject({
  actor: holder(),
  holder: Type.Optional(holder()),
  label: Type.Literal(MERGE_SLOT_LABEL),
  readbackHash: hash2(),
  scope: FencingScopeSchema,
  scopeCommitment: hash2(),
  slotId: identifier3(),
  status: Type.Union([Type.Literal("available"), Type.Literal("acquired")]),
  title: Type.Literal(MERGE_SLOT_TITLE),
  version: Type.Literal(FENCING_SCHEMA_VERSION)
});
var SlotContinuationEvidenceSchema = strictObject({
  after: MergeSlotObservationSchema,
  before: MergeSlotObservationSchema,
  nextHolder: holder(),
  previousHolder: holder()
});
var SlotReleaseEvidenceSchema = strictObject({
  holder: holder(),
  readback: MergeSlotObservationSchema
});
var MutationBatchSchema = strictObject({
  changedRows: Type.Array(ChangedRowSchema, {
    maxItems: FENCING_LIMITS.changedRows
  }),
  checkpoint: CheckpointObservationSchema,
  continuation: Type.Optional(ContinuationEvidenceSchema),
  expectedAggregateCommitment: hash2(),
  expectedAggregateRevision: revision2(),
  /** Exact holder predicate checked inside the topology transaction. */
  expectedHolder: holder(),
  expectedChildren: Type.Array(ExpectedChildRowSchema, {
    maxItems: FENCING_LIMITS.changedRows
  }),
  holder: holder(),
  next: strictObject({
    children: Type.Array(ChildProjectionSchema, {
      maxItems: FENCING_LIMITS.changedRows
    }),
    root: RootProjectionSchema
  }),
  release: Type.Optional(ReleaseEvidenceSchema),
  schema: Type.Literal("sce.fencing.batch"),
  scope: FencingScopeSchema,
  version: Type.Literal(FENCING_SCHEMA_VERSION)
});
var RunStoreNonAppliedResultSchema = Type.Union([
  strictObject({ status: Type.Literal("stale") }),
  strictObject({ status: Type.Literal("holder_mismatch") }),
  strictObject({ status: Type.Literal("ambiguous") }),
  strictObject({ status: Type.Literal("unavailable") }),
  strictObject({ status: Type.Literal("quarantined") })
]);
var RunStoreAppliedResultSchema = strictObject({
  /** Root is always an affected row, followed by every affected child. */
  affectedRowCount: Type.Integer({
    minimum: 1,
    maximum: FENCING_LIMITS.changedRows + 1
  }),
  checkpoint: CheckpointObservationSchema,
  children: Type.Array(ChildProjectionSchema, {
    maxItems: FENCING_LIMITS.changedRows
  }),
  root: RootProjectionSchema,
  status: Type.Literal("applied")
});
var RunStoreResultSchema = Type.Union([
  RunStoreAppliedResultSchema,
  RunStoreNonAppliedResultSchema
]);
var OperationLockStateSchema = strictObject({
  holder: holder(),
  nonce: identifier3(),
  scopeCommitment: hash2(),
  version: Type.Literal(FENCING_SCHEMA_VERSION)
});

// src/fencing/projections.ts
var utf85 = new TextEncoder();
function json(value) {
  return value;
}
function equal(left, right) {
  return canonicalJson(json(left)) === canonicalJson(json(right));
}
function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function holderRunId(holder4) {
  return holder4.split("/", 1)[0] ?? "";
}
function scopeFor(run2) {
  return {
    beadsStoreIdentity: run2.storeIdentity,
    gitRepositoryIdentity: run2.repositoryIdentity,
    integrationBranch: run2.integrationBranch
  };
}
function deriveScopeCommitment(scope) {
  return sha256(
    canonicalJson({ domain: "sce.fencing.scope.v1", scope: json(scope) })
  );
}
function deriveAggregateCommitment(run2) {
  return sha256(
    canonicalJson({ domain: "sce.fencing.aggregate.v1", run: json(run2) })
  );
}
function deriveChildCommitment(unit) {
  return sha256(
    canonicalJson({ domain: "sce.fencing.child.v1", unit: json(unit) })
  );
}
function deriveChangedRowsCommitment(rows) {
  return sha256(
    canonicalJson({
      domain: "sce.fencing.changed-rows.v1",
      rows: json(
        [...rows].sort(
          (left, right) => compareCodeUnits(left.unitId, right.unitId)
        )
      )
    })
  );
}
function childRows(run2) {
  return Object.values(run2.units).map((unit) => ({
    commitment: deriveChildCommitment(unit),
    revision: unit.revision,
    unitId: unit.id
  })).sort((left, right) => compareCodeUnits(left.unitId, right.unitId));
}
function checkpoint(aggregateRevision, aggregateCommitment) {
  return {
    aggregateRevision,
    changedRowsCommitment: deriveChangedRowsCommitment([]),
    rootCommitment: aggregateCommitment
  };
}
function checkpointForBatch(root, changedRows) {
  return {
    aggregateRevision: root.aggregateRevision,
    changedRowsCommitment: deriveChangedRowsCommitment(changedRows),
    rootCommitment: root.aggregateCommitment
  };
}
function withBatchCheckpoint(root, changedRows) {
  return { ...root, checkpoint: checkpointForBatch(root, changedRows) };
}
function makeRootProjection(run2) {
  const aggregateCommitment = deriveAggregateCommitment(run2);
  return {
    aggregateCommitment,
    aggregateRevision: run2.revision,
    checkpoint: checkpoint(run2.revision, aggregateCommitment),
    childRows: [...childRows(run2)],
    holder: run2.controller.holder,
    run: run2,
    schema: "sce.fencing.root",
    scope: scopeFor(run2),
    version: FENCING_SCHEMA_VERSION
  };
}
function makeChildProjection(root, unitId) {
  const unit = root.run.units[unitId];
  if (unit === void 0) return void 0;
  return {
    commitment: deriveChildCommitment(unit),
    holder: root.holder,
    revision: unit.revision,
    schema: "sce.fencing.child",
    scope: root.scope,
    unit,
    unitId,
    version: FENCING_SCHEMA_VERSION
  };
}
function parseSchema(schema, input) {
  const parsed = validate(schema, input);
  return parsed.ok && parsed.value !== void 0 ? { ok: true, value: parsed.value } : { ok: false, reason: parsed.errors.join("; ") };
}
function validateRootProjection(input) {
  const parsed = parseSchema(RootProjectionSchema, input);
  if (!parsed.ok) return parsed;
  const root = parsed.value;
  if (runInvariantErrors(root.run).length > 0)
    return { ok: false, reason: "root run invariants fail" };
  if (!equal(root.scope, scopeFor(root.run)))
    return { ok: false, reason: "root scope disagrees with run" };
  if (root.holder !== root.run.controller.holder)
    return { ok: false, reason: "root holder disagrees with run" };
  if (root.aggregateRevision !== root.run.revision)
    return { ok: false, reason: "root revision disagrees with run" };
  if (root.aggregateCommitment !== deriveAggregateCommitment(root.run))
    return { ok: false, reason: "root aggregate commitment is invalid" };
  if (!equal(root.childRows, childRows(root.run)))
    return { ok: false, reason: "root child rows disagree with run" };
  if (root.checkpoint.aggregateRevision !== root.aggregateRevision || root.checkpoint.rootCommitment !== root.aggregateCommitment)
    return { ok: false, reason: "root checkpoint is invalid" };
  return parsed;
}
function validateChildProjection(input) {
  const parsed = parseSchema(ChildProjectionSchema, input);
  if (!parsed.ok) return parsed;
  const child = parsed.value;
  if (child.unit.id !== child.unitId || child.unit.revision !== child.revision || child.commitment !== deriveChildCommitment(child.unit))
    return { ok: false, reason: "child facts disagree with projection" };
  return parsed;
}
function validateMutationBatch(input) {
  const parsed = parseSchema(MutationBatchSchema, input);
  if (!parsed.ok) return parsed;
  const batch = parsed.value;
  const root = validateRootProjection(batch.next.root);
  if (!root.ok) return { ok: false, reason: root.reason };
  if (!equal(batch.scope, root.value.scope) || batch.holder !== root.value.holder)
    return { ok: false, reason: "batch scope or holder disagrees with root" };
  if (!equal(batch.checkpoint, root.value.checkpoint))
    return { ok: false, reason: "batch checkpoint disagrees with root" };
  if (batch.continuation === void 0 && batch.expectedHolder !== batch.holder)
    return { ok: false, reason: "expected holder disagrees with next holder" };
  if (root.value.aggregateRevision !== batch.expectedAggregateRevision + 1)
    return { ok: false, reason: "next aggregate revision is not exact" };
  if (batch.expectedAggregateCommitment === root.value.aggregateCommitment)
    return { ok: false, reason: "aggregate commitment did not change" };
  const changedIds = batch.changedRows.map((row) => row.unitId);
  if (new Set(changedIds).size !== changedIds.length || [...changedIds].sort().some((id, index) => id !== changedIds[index]))
    return { ok: false, reason: "changed rows are not sorted and unique" };
  if (batch.expectedChildren.length !== batch.changedRows.length || batch.next.children.length !== batch.changedRows.length)
    return { ok: false, reason: "affected child row count is not exact" };
  if (!equal(
    batch.expectedChildren.map((child) => child.unitId),
    changedIds
  ) || !equal(
    batch.next.children.map((child) => child.unitId),
    changedIds
  ))
    return { ok: false, reason: "affected child rows are not ordered exactly" };
  for (const row of batch.changedRows) {
    const expected = batch.expectedChildren.find(
      (item) => item.unitId === row.unitId
    );
    const child = batch.next.children.find(
      (item) => item.unitId === row.unitId
    );
    const rootRow = root.value.childRows.find(
      (item) => item.unitId === row.unitId
    );
    if (expected === void 0 || child === void 0 || rootRow === void 0)
      return { ok: false, reason: "affected child row is missing" };
    const validatedChild = validateChildProjection(child);
    if (!validatedChild.ok) return { ok: false, reason: validatedChild.reason };
    if (expected.expectedRevision !== row.expectedRevision || expected.expectedCommitment !== row.expectedCommitment || row.nextRevision !== row.expectedRevision + 1 || child.revision !== row.nextRevision || child.commitment !== row.nextCommitment || rootRow.revision !== row.nextRevision || rootRow.commitment !== row.nextCommitment || !equal(child.scope, batch.scope) || child.holder !== batch.holder || !equal(child.unit, root.value.run.units[row.unitId]))
      return { ok: false, reason: "affected child row disagrees with batch" };
  }
  if (batch.checkpoint.aggregateRevision !== root.value.aggregateRevision || batch.checkpoint.rootCommitment !== root.value.aggregateCommitment || batch.checkpoint.changedRowsCommitment !== deriveChangedRowsCommitment(batch.changedRows))
    return { ok: false, reason: "batch checkpoint is invalid" };
  const scopeCommitment = deriveScopeCommitment(batch.scope);
  if (batch.continuation !== void 0 && (batch.continuation.scopeCommitment !== scopeCommitment || batch.continuation.nextHolder !== batch.holder || batch.continuation.previousHolder !== batch.expectedHolder || batch.continuation.previousHolder === batch.holder || holderRunId(batch.continuation.previousHolder) !== holderRunId(batch.holder)))
    return { ok: false, reason: "continuation evidence is invalid" };
  if (batch.release !== void 0 && (batch.release.scopeCommitment !== scopeCommitment || batch.release.holder !== batch.holder))
    return { ok: false, reason: "release evidence is invalid" };
  return parsed;
}

// src/fencing/operation-lock.ts
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync as realpathSync2,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { join as join2 } from "node:path";
import { createConnection, createServer } from "node:net";
var LOCK_DIRECTORY = ".sce-op";
var SOCKET_NAME = "l";
var STATE_NAME = "s";
var STATE_MAX_BYTES = 4096;
var MAX_ACQUIRE_ATTEMPTS = 4;
var utf86 = new TextEncoder();
function ownerMatches(uid) {
  return typeof process.getuid !== "function" || uid === process.getuid();
}
function identity(stat2) {
  return {
    dev: stat2.dev,
    ino: stat2.ino,
    mode: stat2.mode & 511,
    uid: stat2.uid
  };
}
function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.uid === right.uid;
}
function absentError(error) {
  return error.code === "ENOENT";
}
function strictDirectory(path2, expectedMode) {
  try {
    const stat2 = lstatSync(path2);
    return stat2.isDirectory() && !stat2.isSymbolicLink() && ownerMatches(stat2.uid) && (expectedMode === void 0 || (stat2.mode & 511) === expectedMode);
  } catch {
    return false;
  }
}
function captureSocket(path2) {
  try {
    const stat2 = lstatSync(path2);
    if (!stat2.isSocket() || stat2.isSymbolicLink() || !ownerMatches(stat2.uid) || (stat2.mode & 511) !== 384)
      return { kind: "invalid" };
    return { kind: "valid", value: { identity: identity(stat2) } };
  } catch (error) {
    return absentError(error) ? { kind: "absent" } : { kind: "invalid" };
  }
}
function stateSource(state) {
  return canonicalJson(state);
}
function captureState(path2) {
  let descriptor;
  try {
    const before = lstatSync(path2);
    if (!before.isFile() || before.isSymbolicLink() || !ownerMatches(before.uid) || (before.mode & 511) !== 384 || constants.O_NOFOLLOW === void 0)
      return { kind: "invalid" };
    descriptor = openSync(path2, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !ownerMatches(opened.uid) || (opened.mode & 511) !== 384 || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > STATE_MAX_BYTES)
      return { kind: "invalid" };
    const source = readFileSync(descriptor, "utf8");
    if (utf86.encode(source).byteLength > STATE_MAX_BYTES)
      return { kind: "invalid" };
    const input = JSON.parse(source);
    const parsed = validate(
      OperationLockStateSchema,
      input
    );
    if (!parsed.ok || parsed.value === void 0 || stateSource(parsed.value) !== source)
      return { kind: "invalid" };
    return {
      kind: "valid",
      value: { identity: identity(opened), source, state: parsed.value }
    };
  } catch (error) {
    return absentError(error) ? { kind: "absent" } : { kind: "invalid" };
  } finally {
    if (descriptor !== void 0) closeSync(descriptor);
  }
}
function writeState(path2, state) {
  let descriptor;
  try {
    if (constants.O_NOFOLLOW === void 0) return { kind: "invalid" };
    descriptor = openSync(
      path2,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      384
    );
    writeFileSync(descriptor, stateSource(state), "utf8");
  } catch (error) {
    return absentError(error) ? { kind: "absent" } : { kind: "invalid" };
  } finally {
    if (descriptor !== void 0) closeSync(descriptor);
  }
  return captureState(path2);
}
function paths(commonDir) {
  try {
    if (realpathSync2(commonDir) !== commonDir || !strictDirectory(commonDir))
      return void 0;
    const directory = join2(commonDir, LOCK_DIRECTORY);
    try {
      mkdirSync(directory, { mode: 448 });
    } catch (error) {
      if (error.code !== "EEXIST") return void 0;
    }
    if (!strictDirectory(directory, 448)) return void 0;
    if (statSync(commonDir).dev !== statSync(directory).dev) return void 0;
    return {
      directory,
      socket: join2(directory, SOCKET_NAME),
      state: join2(directory, STATE_NAME)
    };
  } catch {
    return void 0;
  }
}
function listen(socket) {
  return new Promise((resolve5) => {
    const server = createServer((connection) => connection.destroy());
    const fail = (error) => {
      resolve5({ code: error.code ?? "UNKNOWN" });
    };
    server.once("error", fail);
    server.listen(socket, () => {
      server.removeListener("error", fail);
      resolve5({ server });
    });
  });
}
function socketIsLive(socketPath) {
  return new Promise((resolve5) => {
    const socket = createConnection(socketPath);
    socket.once("connect", () => {
      socket.destroy();
      resolve5(true);
    });
    socket.once("error", (error) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED" || error.code === "ENOENT")
        resolve5(false);
      else resolve5(void 0);
    });
  });
}
async function closeServer(server) {
  return new Promise((resolve5) => {
    server.close((error) => resolve5(error === void 0));
  });
}
function removeSocket(path2, expected) {
  const current = captureSocket(path2);
  if (current.kind === "absent") return "absent";
  if (current.kind === "invalid") return "invalid";
  if (!sameIdentity(current.value.identity, expected.identity))
    return "changed";
  try {
    unlinkSync(path2);
  } catch (error) {
    return absentError(error) ? "absent" : "changed";
  }
  return captureSocket(path2).kind === "absent" ? "removed" : "changed";
}
function removeState(path2, expected) {
  const current = captureState(path2);
  if (current.kind === "absent") return "absent";
  if (current.kind === "invalid") return "invalid";
  if (!sameIdentity(current.value.identity, expected.identity) || current.value.source !== expected.source)
    return "changed";
  try {
    unlinkSync(path2);
  } catch (error) {
    return absentError(error) ? "absent" : "changed";
  }
  return captureState(path2).kind === "absent" ? "removed" : "changed";
}
function cleanupStatus(result2) {
  if (result2 === "removed" || result2 === "absent") return "retry";
  return result2 === "invalid" ? "quarantined" : "unavailable";
}
var OperationLock = class _OperationLock {
  #paths;
  #server;
  #socket;
  #state;
  constructor(pathsInput, server, socket, state) {
    this.#paths = pathsInput;
    this.#server = server;
    this.#socket = socket;
    this.#state = state;
  }
  static async acquire(input) {
    const lockPaths = paths(input.commonDir);
    if (lockPaths === void 0) return { status: "quarantined" };
    const desired = {
      holder: input.holder,
      nonce: input.nonce,
      scopeCommitment: deriveScopeCommitment(input.scope),
      version: FENCING_SCHEMA_VERSION
    };
    if (!validate(OperationLockStateSchema, desired).ok)
      return { status: "quarantined" };
    for (let attemptNumber = 0; attemptNumber < MAX_ACQUIRE_ATTEMPTS; attemptNumber += 1) {
      const socket = captureSocket(lockPaths.socket);
      const state = captureState(lockPaths.state);
      if (socket.kind === "invalid" || state.kind === "invalid")
        return { status: "quarantined" };
      if (socket.kind === "absent" && state.kind === "valid") {
        const cleaned = cleanupStatus(
          removeState(lockPaths.state, state.value)
        );
        if (cleaned === "retry") continue;
        return { status: cleaned };
      }
      if (socket.kind === "valid" && state.kind === "absent") {
        const live = await socketIsLive(lockPaths.socket);
        if (live === true) return { status: "held" };
        if (live === void 0) return { status: "unavailable" };
        const cleaned = cleanupStatus(
          removeSocket(lockPaths.socket, socket.value)
        );
        if (cleaned === "retry") continue;
        return { status: cleaned };
      }
      if (socket.kind === "valid" && state.kind === "valid") {
        const live = await socketIsLive(lockPaths.socket);
        if (live === true) return { status: "held" };
        if (live === void 0) return { status: "unavailable" };
        const removedSocket = cleanupStatus(
          removeSocket(lockPaths.socket, socket.value)
        );
        if (removedSocket !== "retry") return { status: removedSocket };
        const removedState = cleanupStatus(
          removeState(lockPaths.state, state.value)
        );
        if (removedState !== "retry") return { status: removedState };
        continue;
      }
      const listened = await listen(lockPaths.socket);
      if (listened.server === void 0) {
        if (listened.code === "EADDRINUSE") continue;
        return { status: "unavailable" };
      }
      try {
        chmodSync(lockPaths.socket, 384);
      } catch {
        await closeServer(listened.server);
        return { status: "quarantined" };
      }
      const ownedSocket = captureSocket(lockPaths.socket);
      if (ownedSocket.kind !== "valid") {
        await closeServer(listened.server);
        return { status: "quarantined" };
      }
      const written = writeState(lockPaths.state, desired);
      if (written.kind !== "valid") {
        await closeServer(listened.server);
        const cleanup = cleanupStatus(
          removeSocket(lockPaths.socket, ownedSocket.value)
        );
        return {
          status: cleanup === "quarantined" ? "quarantined" : "unavailable"
        };
      }
      return {
        status: "acquired",
        lock: new _OperationLock(
          lockPaths,
          listened.server,
          ownedSocket.value,
          written.value
        )
      };
    }
    return { status: "unavailable" };
  }
  async release() {
    const currentSocket = captureSocket(this.#paths.socket);
    const currentState = captureState(this.#paths.state);
    if (currentSocket.kind === "invalid" || currentState.kind === "invalid")
      return { status: "quarantined" };
    if (currentSocket.kind !== "valid" || currentState.kind !== "valid")
      return { status: "holder_mismatch" };
    if (!sameIdentity(currentSocket.value.identity, this.#socket.identity) || !sameIdentity(currentState.value.identity, this.#state.identity) || currentState.value.source !== this.#state.source)
      return { status: "holder_mismatch" };
    if (!await closeServer(this.#server)) return { status: "unavailable" };
    const socketResult = removeSocket(this.#paths.socket, this.#socket);
    if (socketResult === "invalid") return { status: "quarantined" };
    if (socketResult === "changed") return { status: "holder_mismatch" };
    const stateResult2 = removeState(this.#paths.state, this.#state);
    if (stateResult2 === "invalid") return { status: "quarantined" };
    if (stateResult2 === "changed") return { status: "holder_mismatch" };
    return { status: "released" };
  }
};

// src/fencing/merge-slot.ts
function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}
function slotReadbackPayload(observation) {
  return {
    actor: observation.actor,
    ...observation.holder === void 0 ? {} : { holder: observation.holder },
    label: observation.label,
    scope: observation.scope,
    scopeCommitment: observation.scopeCommitment,
    slotId: observation.slotId,
    status: observation.status,
    title: observation.title,
    version: observation.version
  };
}
function deriveSlotReadbackHash(observation) {
  return sha256(
    canonicalJson({
      domain: "sce.fencing.merge-slot.v1",
      observation: slotReadbackPayload(observation)
    })
  );
}
function slotId(prefix) {
  return `${prefix}-merge-slot`;
}
function runId(holder4) {
  return holder4.split("/", 1)[0] ?? "";
}
function validateMergeSlotObservation(input, prefix, scope) {
  const parsed = validate(
    MergeSlotObservationSchema,
    input
  );
  if (!parsed.ok || parsed.value === void 0)
    return { ok: false, reason: parsed.errors.join("; ") };
  const observation = parsed.value;
  if (observation.slotId !== slotId(prefix) || !same(observation.scope, scope) || observation.scopeCommitment !== deriveScopeCommitment(scope) || observation.readbackHash !== deriveSlotReadbackHash(observation))
    return { ok: false, reason: "slot identity or readback is invalid" };
  if (observation.status === "available" && observation.holder !== void 0 || observation.status === "acquired" && (observation.holder === void 0 || observation.actor !== observation.holder))
    return { ok: false, reason: "slot status and holder disagree" };
  return { ok: true, value: observation };
}
function continuationMatches(input, prefix, scope, holder4, knownHolder, observation) {
  const parsed = validate(
    SlotContinuationEvidenceSchema,
    input
  );
  if (!parsed.ok || parsed.value === void 0) return false;
  const evidence = parsed.value;
  if (evidence.nextHolder !== holder4 || evidence.previousHolder === holder4 || knownHolder !== evidence.previousHolder || runId(evidence.previousHolder) !== runId(holder4) || !same(evidence.after, observation))
    return false;
  const before = validateMergeSlotObservation(evidence.before, prefix, scope);
  const after = validateMergeSlotObservation(evidence.after, prefix, scope);
  return before.ok && after.ok && before.value.status === "acquired" && before.value.holder === evidence.previousHolder && before.value.actor === evidence.previousHolder && after.value.status === "acquired" && after.value.holder === holder4 && after.value.actor === holder4;
}
function decideControllerSlot(prefix, scope, holder4, knownHolder, observationInput, continuationInput, releaseInput) {
  const observation = validateMergeSlotObservation(
    observationInput,
    prefix,
    scope
  );
  if (!observation.ok) return { kind: "quarantined" };
  if (observation.value.status === "available") {
    if (knownHolder === void 0) return { kind: "acquire" };
    return validateSlotRelease(prefix, scope, knownHolder, releaseInput).ok ? { kind: "acquire" } : { kind: "blocked" };
  }
  if (observation.value.holder !== void 0 && runId(observation.value.holder) === runId(holder4) && continuationMatches(
    continuationInput,
    prefix,
    scope,
    holder4,
    knownHolder,
    observation.value
  ))
    return { kind: "continue" };
  if (observation.value.holder === holder4 && knownHolder === holder4)
    return { kind: "resume" };
  return { kind: "blocked" };
}
function validateSlotRelease(prefix, scope, holder4, evidenceInput) {
  const parsed = validate(
    SlotReleaseEvidenceSchema,
    evidenceInput
  );
  if (!parsed.ok || parsed.value === void 0)
    return { ok: false, reason: parsed.errors.join("; ") };
  if (parsed.value.holder !== holder4)
    return { ok: false, reason: "release holder differs" };
  const readback = validateMergeSlotObservation(
    parsed.value.readback,
    prefix,
    scope
  );
  if (!readback.ok || readback.value.status !== "available" || readback.value.holder !== void 0 || readback.value.actor !== holder4)
    return { ok: false, reason: "release lacks positive available readback" };
  return { ok: true, value: parsed.value };
}

// src/commands/recovery.ts
var InitialControllerAcquireSchema = strictObject({
  expected: strictObject({
    children: Type.Literal("absent"),
    holder: Type.String({
      minLength: 3,
      maxLength: 321,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$"
    }),
    root: Type.Literal("absent"),
    scope: FencingScopeSchema
  }),
  next: strictObject({
    children: Type.Array(ChildProjectionSchema, { maxItems: 64 }),
    root: RootProjectionSchema
  }),
  schema: Type.Literal("sce.recovery.initial-controller-acquire"),
  version: Type.Literal(1)
});
var RECOVERABLE_EFFECT_KINDS = /* @__PURE__ */ new Set([
  "controller_acquire",
  "controller_release",
  "branch_create",
  "worktree_create",
  "candidate_collect",
  "publish",
  "integrate"
]);
function isRecoverableEffect(effect2) {
  if (!RECOVERABLE_EFFECT_KINDS.has(
    effect2.kind
  ))
    return false;
  if (effect2.kind === "controller_acquire" || effect2.kind === "controller_release")
    return "slotTransition" in effect2.params && effect2.params.slotTransition !== void 0;
  return true;
}
function same2(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}
function isRun(value) {
  return "effectJournal" in value;
}
function effectFor(entry, run2) {
  return rehydrateEffect(run2, entry);
}
function validReadback(readback, scope) {
  if (readback === void 0) return void 0;
  const root = validateRootProjection(readback.root);
  if (!root.ok || !same2(root.value.scope, scope)) return void 0;
  const expected = root.value.childRows;
  if (readback.children.length !== expected.length) return void 0;
  for (const row of expected) {
    const child = readback.children.find(
      (candidate) => candidate.unitId === row.unitId
    );
    const parsed = child === void 0 ? void 0 : validateChildProjection(child);
    if (parsed === void 0 || !parsed.ok || parsed.value.commitment !== row.commitment || parsed.value.revision !== row.revision || !same2(parsed.value.unit, root.value.run.units[row.unitId]) || parsed.value.holder !== root.value.holder || !same2(parsed.value.scope, scope))
      return void 0;
  }
  return root.value.run;
}
function loadOutcome(status) {
  return { status: status === "absent" ? "uninitialized" : status };
}
function batchFor(before, nextRun) {
  const nextBase = makeRootProjection(nextRun);
  const changedIds = Object.keys(nextRun.units).filter((unitId) => !same2(before.run.units[unitId], nextRun.units[unitId])).sort();
  if (Object.keys(before.run.units).some(
    (unitId) => nextRun.units[unitId] === void 0
  ))
    return void 0;
  const changedRows = changedIds.map((unitId) => {
    const prior = before.childRows.find((row) => row.unitId === unitId);
    const child = makeChildProjection(nextBase, unitId);
    if (prior === void 0 || child === void 0) return void 0;
    return {
      expectedCommitment: prior.commitment,
      expectedRevision: prior.revision,
      nextCommitment: child.commitment,
      nextRevision: child.revision,
      unitId
    };
  });
  if (changedRows.some((row) => row === void 0)) return void 0;
  const rows = changedRows;
  const next = withBatchCheckpoint(nextBase, rows);
  const candidate = {
    changedRows: rows,
    checkpoint: {
      aggregateRevision: next.aggregateRevision,
      changedRowsCommitment: deriveChangedRowsCommitment(rows),
      rootCommitment: next.aggregateCommitment
    },
    expectedAggregateCommitment: before.aggregateCommitment,
    expectedAggregateRevision: before.aggregateRevision,
    expectedChildren: rows.map((row) => ({
      expectedCommitment: row.expectedCommitment,
      expectedRevision: row.expectedRevision,
      unitId: row.unitId
    })),
    expectedHolder: before.holder,
    holder: next.holder,
    next: {
      children: rows.map((row) => makeChildProjection(next, row.unitId)),
      root: next
    },
    schema: "sce.fencing.batch",
    scope: next.scope,
    version: 1
  };
  return candidate;
}
function isPreOwnershipAcquire(before, next) {
  return before.state === "initializing" && before.controller.state === "unacquired" && next.state === "initializing" && next.controller.state === "acquire_intent" && next.effectJournal.length === before.effectJournal.length + 1 && next.effectJournal.at(-1)?.kind === "controller_acquire" && next.effectJournal.at(-1)?.slotTransition !== void 0;
}
function isInitialAcquire(next, holder4, scope) {
  const run2 = next.run;
  return next.holder === holder4 && same2(next.scope, scope) && run2.revision === 1 && run2.state === "initializing" && run2.controller.state === "acquire_intent" && next.childRows.length === Object.keys(run2.units).length && run2.effectJournal.length === 1 && run2.effectJournal[0]?.kind === "controller_acquire" && run2.effectJournal[0]?.status === "intended" && run2.effectJournal[0]?.slotTransition !== void 0;
}
function initialRequest(run2, holder4, scope) {
  const root = makeRootProjection(run2);
  if (!isInitialAcquire(root, holder4, scope)) return void 0;
  const candidate = {
    expected: { children: "absent", holder: holder4, root: "absent", scope },
    next: {
      children: Object.keys(run2.units).sort().map((unitId) => makeChildProjection(root, unitId)),
      root
    },
    schema: "sce.recovery.initial-controller-acquire",
    version: 1
  };
  const parsed = validate(
    InitialControllerAcquireSchema,
    candidate
  );
  return parsed.ok && parsed.value !== void 0 ? parsed.value : void 0;
}
function ambiguousEvent(run2, entry, observationHash2) {
  return {
    effectId: entry.effectId,
    effectKind: entry.kind,
    eventId: `recover-${entry.effectId}`,
    expectedRevision: run2.revision,
    ...observationHash2 === void 0 ? {} : { observationHash: observationHash2 },
    type: "effect_ambiguous",
    unitId: entry.unitId
  };
}
function observationFor(run2, entry, event) {
  const parsed = validate(ProtocolEventSchema, event);
  if (!parsed.ok || parsed.value === void 0) return void 0;
  if (!("effectId" in parsed.value) || parsed.value.effectId !== entry.effectId || parsed.value.effectKind !== entry.kind)
    return void 0;
  return { ...parsed.value, expectedRevision: run2.revision };
}
function createRecoveryRunner(options) {
  const fault = (point) => options.fault?.(point);
  async function preparedControllerEvent(event, run2, proof) {
    if (event.type !== "controller_acquire_intent" && event.type !== "controller_release_intent" || event.slotTransition !== void 0)
      return { ok: true, event };
    if (options.prepareControllerTransition === void 0)
      return { ok: false, outcome: { status: "blocked" } };
    let result2;
    try {
      result2 = await options.prepareControllerTransition({
        holder: proof.holder,
        kind: event.type === "controller_acquire_intent" ? "acquire" : "release",
        run: run2,
        scope: proof.scope
      });
    } catch {
      return { ok: false, outcome: { status: "ambiguous" } };
    }
    if (result2.status !== "planned")
      return { ok: false, outcome: { status: result2.status } };
    const candidate = { ...event, slotTransition: result2.transition };
    const parsed = validate(ProtocolEventSchema, candidate);
    return parsed.ok && parsed.value !== void 0 ? { ok: true, event: parsed.value } : { ok: false, outcome: { status: "corrupt" } };
  }
  async function persist(before, reduction, preOwnership = false) {
    if (!reduction.ok) return { status: "corrupt" };
    const batch = batchFor(before, reduction.nextState);
    if (batch === void 0) return { status: "quarantined" };
    fault("before_intent_persist");
    fault("during_intent_persist");
    const result2 = preOwnership ? await options.preOwnership.persistControllerAcquireIntent(batch) : await options.store.compareAndSet(batch);
    fault("after_intent_persist");
    const parsed = validate(RunStoreResultSchema, result2);
    if (!parsed.ok || parsed.value === void 0)
      return { status: "quarantined" };
    if (parsed.value.status !== "applied")
      return {
        status: parsed.value.status === "holder_mismatch" ? "blocked" : parsed.value.status
      };
    if (parsed.value.affectedRowCount !== batch.changedRows.length + 1 || !same2(parsed.value.root, batch.next.root) || !same2(parsed.value.children, batch.next.children) || !same2(parsed.value.checkpoint, batch.checkpoint))
      return { status: "quarantined" };
    const read = validReadback(
      { children: parsed.value.children, root: parsed.value.root },
      before.scope
    );
    return read === void 0 || !same2(read, reduction.nextState) ? { status: "quarantined" } : read;
  }
  async function persistEvent(beforeRoot, run2, event, preOwnership = false) {
    return persist(beforeRoot, reduce(run2, event), preOwnership);
  }
  async function reconcile(root, run2) {
    let currentRoot = root;
    let current = run2;
    for (const entry of current.effectJournal.filter(
      (value) => value.status === "intended" || value.status === "ambiguous"
    )) {
      const effect2 = effectFor(entry, current);
      if (effect2 === void 0) return { status: "blocked" };
      if (!isRecoverableEffect(effect2)) return { status: "blocked" };
      const answer = await options.adapter.reconcile(effect2, current);
      if (answer.status === "unavailable") return { status: "unavailable" };
      let settledAnswer = answer;
      if (answer.status === "absent") {
        try {
          fault("before_act");
          fault("during_act");
          settledAnswer = await options.adapter.execute(effect2, current);
          fault("after_act");
        } catch {
          settledAnswer = { status: "ambiguous" };
        }
        if (settledAnswer.status === "unavailable")
          return { status: "unavailable" };
      }
      const event = settledAnswer.status === "observed" ? observationFor(current, entry, settledAnswer.observation) : ambiguousEvent(
        current,
        entry,
        settledAnswer.status === "ambiguous" ? settledAnswer.observationHash : void 0
      );
      if (event === void 0) return { status: "corrupt" };
      const persisted = await persistEvent(currentRoot, current, event);
      if (!isRun(persisted)) return persisted;
      current = persisted;
      currentRoot = makeRootProjection(current);
      if (settledAnswer.status !== "observed") return { status: "ambiguous" };
    }
    return current;
  }
  return async function recoverAndRun(requested) {
    const proof = await options.proveTopology();
    if (proof === void 0) return { status: "unavailable" };
    const lockResult = await (options.acquireOperationLock ?? OperationLock.acquire)({
      commonDir: proof.commonDir,
      holder: proof.holder,
      nonce: options.nonce,
      scope: proof.scope
    });
    if (lockResult.status !== "acquired")
      return {
        status: lockResult.status === "held" ? "held" : lockResult.status
      };
    try {
      let initialized = false;
      const loadedResult = await options.store.load();
      let loaded = loadedResult.status === "observed" ? loadedResult.value : void 0;
      if (loadedResult.status !== "observed" && loadedResult.status !== "absent")
        return loadOutcome(loadedResult.status);
      if (loadedResult.status === "absent") {
        if (requested === void 0 || options.initialRun === void 0 || options.preOwnership.createControllerAcquireIntent === void 0)
          return { status: "uninitialized" };
        const initial = validate(
          RepositoryRunSchema,
          options.initialRun
        );
        const first = validate(ProtocolEventSchema, requested);
        if (!initial.ok || initial.value === void 0 || !first.ok || first.value === void 0 || initial.value.controller.holder !== proof.holder || initial.value.state !== "initializing" || initial.value.controller.state !== "unacquired" || !same2(
          {
            beadsStoreIdentity: initial.value.storeIdentity,
            gitRepositoryIdentity: initial.value.repositoryIdentity,
            integrationBranch: initial.value.integrationBranch
          },
          proof.scope
        ) || first.value.type !== "controller_acquire_intent" || first.value.expectedRevision !== initial.value.revision)
          return { status: "corrupt" };
        const prepared2 = await preparedControllerEvent(
          first.value,
          initial.value,
          proof
        );
        if (!prepared2.ok) return prepared2.outcome;
        const created = reduce(initial.value, prepared2.event);
        if (!created.ok || !isPreOwnershipAcquire(initial.value, created.nextState))
          return { status: "corrupt" };
        const creation = initialRequest(
          created.nextState,
          proof.holder,
          proof.scope
        );
        if (creation === void 0) return { status: "corrupt" };
        fault("before_intent_persist");
        fault("during_intent_persist");
        const result2 = await options.preOwnership.createControllerAcquireIntent(creation);
        fault("after_intent_persist");
        const parsedResult = validate(
          RunStoreResultSchema,
          result2
        );
        if (!parsedResult.ok || parsedResult.value === void 0)
          return { status: "quarantined" };
        if (parsedResult.value.status !== "applied")
          return {
            status: parsedResult.value.status === "holder_mismatch" ? "blocked" : parsedResult.value.status
          };
        if (parsedResult.value.affectedRowCount !== creation.next.children.length + 1 || !same2(parsedResult.value.root, creation.next.root) || !same2(parsedResult.value.children, creation.next.children) || !same2(parsedResult.value.checkpoint, creation.next.root.checkpoint))
          return { status: "quarantined" };
        const createdRun = validReadback(
          {
            children: parsedResult.value.children,
            root: parsedResult.value.root
          },
          proof.scope
        );
        if (createdRun === void 0 || !same2(createdRun, created.nextState))
          return { status: "quarantined" };
        loaded = {
          children: parsedResult.value.children,
          root: parsedResult.value.root
        };
        initialized = true;
        requested = void 0;
      }
      if (loaded === void 0) return { status: "corrupt" };
      const run2 = validReadback(loaded, proof.scope);
      if (run2 === void 0 || runInvariantErrors(run2).length > 0 || loaded.root.holder !== proof.holder || run2.controller.holder !== proof.holder)
        return { status: "corrupt" };
      const root = loaded.root;
      const reconciled = await reconcile(root, run2);
      if (!isRun(reconciled)) return reconciled;
      if (requested === void 0)
        return {
          status: initialized ? "reconciled" : "idle",
          revision: reconciled.revision,
          run: reconciled
        };
      const event = validate(ProtocolEventSchema, requested);
      if (!event.ok || event.value === void 0) return { status: "corrupt" };
      if (event.value.expectedRevision !== reconciled.revision)
        return { status: "stale" };
      const prepared = await preparedControllerEvent(
        event.value,
        reconciled,
        proof
      );
      if (!prepared.ok) return prepared.outcome;
      const reduction = reduce(reconciled, prepared.event);
      if (!reduction.ok) return { status: "blocked" };
      const emitted = reduction.effects[0];
      if (emitted !== void 0 && !isRecoverableEffect(emitted))
        return { status: "blocked" };
      const preOwnership = isPreOwnershipAcquire(
        reconciled,
        reduction.nextState
      );
      const intent2 = await persist(
        makeRootProjection(reconciled),
        reduction,
        preOwnership
      );
      if (!isRun(intent2)) return intent2;
      const effect2 = emitted;
      if (effect2 === void 0) {
        return { status: "applied", revision: intent2.revision, run: intent2 };
      }
      fault("before_act");
      let acted;
      try {
        fault("during_act");
        acted = await options.adapter.execute(effect2, intent2);
        fault("after_act");
      } catch {
        acted = { status: "ambiguous" };
      }
      const entry = intent2.effectJournal.find(
        (candidate) => candidate.effectId === effect2.effectId
      );
      if (entry === void 0) return { status: "corrupt" };
      if (acted.status === "unavailable") return { status: "unavailable" };
      const observed2 = acted.status === "observed" ? observationFor(intent2, entry, acted.observation) : ambiguousEvent(intent2, entry, acted.observationHash);
      if (observed2 === void 0) return { status: "corrupt" };
      fault("before_observation_persist");
      fault("during_observation_persist");
      const settled = await persistEvent(
        makeRootProjection(intent2),
        intent2,
        observed2
      );
      fault("after_observation_persist");
      if (!isRun(settled)) return settled;
      return acted.status === "observed" ? { status: "applied", revision: settled.revision, run: settled } : { status: "ambiguous" };
    } finally {
      const released = await lockResult.lock.release();
      if (released.status !== "released")
        return {
          status: released.status === "holder_mismatch" ? "blocked" : released.status
        };
    }
  };
}
function observationHash(value) {
  return sha256(
    canonicalJson({ domain: "sce.recovery.observation.v1", value })
  );
}

// src/commands/production-recovery.ts
function ambiguous() {
  return { status: "ambiguous" };
}
function unavailable() {
  return { status: "unavailable" };
}
function classifyDiscovery(result2) {
  if (result2.state === "observed") return "observed";
  if (result2.state === "refused" && result2.code === "GIT_ABSENT")
    return "absent";
  return "ambiguous";
}
function eventBase2(effect2, run2) {
  return {
    effectId: effect2.effectId,
    effectKind: effect2.kind,
    eventId: `recover-${effect2.effectId}`,
    expectedRevision: run2.revision,
    observationHash: observationHash({
      effectId: effect2.effectId,
      kind: effect2.kind,
      paramsHash: effect2.paramsHash
    }),
    unitId: effect2.unitId
  };
}
function observed(effect2, run2) {
  const base = eventBase2(effect2, run2);
  switch (effect2.kind) {
    case "controller_acquire":
      return {
        observation: {
          ...base,
          controllerFencingToken: effect2.params.controllerFencingToken,
          holder: effect2.params.holder,
          type: "controller_acquired"
        },
        status: "observed"
      };
    case "controller_release":
      return {
        observation: { ...base, type: "controller_released" },
        status: "observed"
      };
    case "branch_create":
      return {
        observation: {
          ...base,
          branchRef: effect2.params.branchRef,
          type: "branch_observed"
        },
        status: "observed"
      };
    case "worktree_create":
      return {
        observation: {
          ...base,
          type: "worktree_observed",
          worktreePath: effect2.params.worktreePath
        },
        status: "observed"
      };
    case "publish":
      return {
        observation: {
          ...base,
          publication: {
            kind: "push_branch",
            remoteHeadOid: effect2.params.candidate.headOid
          },
          type: "publish_observed"
        },
        status: "observed"
      };
    case "integrate":
      return {
        observation: {
          ...base,
          baseOid: effect2.params.candidate.baseOid,
          controllerFencingToken: effect2.params.controllerFencingToken,
          headOid: effect2.params.candidate.headOid,
          integrationOid: effect2.params.candidate.headOid,
          treeOid: effect2.params.candidate.treeOid,
          type: "integrate_observed"
        },
        status: "observed"
      };
    default:
      return void 0;
  }
}
function controllerTransition(effect2) {
  return effect2.kind === "controller_acquire" || effect2.kind === "controller_release" ? effect2.params.slotTransition : void 0;
}
function worktreeBase(effect2, run2) {
  return effect2.kind === "worktree_create" && effect2.unitId !== null ? run2.units[effect2.unitId]?.baseOid : void 0;
}
function canPublish(effect2) {
  return effect2.params.completionBoundary !== "pr-handoff" && effect2.params.authorityProfile !== "local-change-only";
}
function remote(options) {
  return options.git.remote;
}
function gitMatchesRun(repository, run2) {
  return repository.identity === run2.repositoryIdentity && repository.objectFormat === run2.gitObjectFormat;
}
function transitionMatchesRun(effect2, run2) {
  const transition = controllerTransition(effect2);
  if (transition === void 0 || transition === null || typeof transition !== "object" || !("scope" in transition) || !("holder" in transition))
    return false;
  const scope = transition.scope;
  if (scope.beadsStoreIdentity !== run2.storeIdentity || scope.gitRepositoryIdentity !== run2.repositoryIdentity || scope.integrationBranch !== run2.integrationBranch || transition.holder !== run2.controller.holder)
    return false;
  return effect2.kind === "controller_acquire" || effect2.kind === "controller_release" ? effect2.params.controllerFencingToken === run2.controllerFencingToken && effect2.params.holder === run2.controller.holder : false;
}
function localIntegrationRef(branch) {
  return `refs/heads/${branch}`;
}
function createProductionRecoveryEffectAdapter(options) {
  const git = options.git;
  async function discover(effect2, run2) {
    const done = observed(effect2, run2);
    if (done === void 0) return ambiguous();
    if (effect2.kind !== "controller_acquire" && effect2.kind !== "controller_release" && !gitMatchesRun(git.repository, run2) || (effect2.kind === "controller_acquire" || effect2.kind === "controller_release") && !transitionMatchesRun(effect2, run2))
      return ambiguous();
    try {
      switch (effect2.kind) {
        case "controller_acquire":
        case "controller_release": {
          const transition = controllerTransition(effect2);
          if (transition === void 0 || options.topology === void 0)
            return ambiguous();
          const result2 = await options.topology.reconcileControllerTransition(transition);
          if (result2.status === "observed") return done;
          if (result2.status === "absent") return { status: "absent" };
          return result2.status === "unavailable" ? unavailable() : ambiguous();
        }
        case "branch_create":
          return discovered(
            done,
            await discoverBranch(git.runner, git.repository, {
              base: effect2.params.baseOid,
              branch: effect2.params.branchRef
            })
          );
        case "worktree_create": {
          const base = worktreeBase(effect2, run2);
          if (base === void 0) return ambiguous();
          return discovered(
            done,
            await discoverWorktree(git.runner, git.repository, {
              branch: effect2.params.branchRef,
              head: base,
              path: effect2.params.worktreePath
            })
          );
        }
        case "publish": {
          const configuredRemote = remote(options);
          if (configuredRemote === void 0 || !canPublish(effect2))
            return ambiguous();
          return discovered(
            done,
            await discoverPublication(git.runner, git.repository, {
              candidate: effect2.params.candidate.headOid,
              remote: configuredRemote,
              remoteBranch: effect2.params.branchRef
            })
          );
        }
        case "integrate": {
          if (effect2.params.integrationProfile === "local-ff")
            return discovered(
              done,
              await discoverIntegration(git.runner, git.repository, {
                candidate: effect2.params.candidate.headOid,
                integrationRef: localIntegrationRef(
                  effect2.params.integrationBranch
                )
              })
            );
          const configuredRemote = remote(options);
          if (effect2.params.integrationProfile !== "remote-ff" || configuredRemote === void 0)
            return ambiguous();
          return discovered(
            done,
            await discoverRemoteIntegration(git.runner, git.repository, {
              candidate: effect2.params.candidate.headOid,
              integrationBranch: effect2.params.integrationBranch,
              remote: configuredRemote
            })
          );
        }
        // The durable candidate intent has no exact candidate OID/tree/scope
        // binding.  Never infer those values from a worktree during recovery.
        case "candidate_collect":
          return ambiguous();
        default:
          return ambiguous();
      }
    } catch {
      return ambiguous();
    }
  }
  async function execute(effect2, run2) {
    const done = observed(effect2, run2);
    if (done === void 0) return ambiguous();
    if (effect2.kind !== "controller_acquire" && effect2.kind !== "controller_release" && !gitMatchesRun(git.repository, run2) || (effect2.kind === "controller_acquire" || effect2.kind === "controller_release") && !transitionMatchesRun(effect2, run2))
      return ambiguous();
    try {
      switch (effect2.kind) {
        case "controller_acquire":
        case "controller_release": {
          const transition = controllerTransition(effect2);
          const executor = options.topology?.executeControllerTransition;
          if (transition === void 0 || executor === void 0)
            return ambiguous();
          const result2 = await executor(transition);
          return result2.status === "observed" ? done : result2.status === "unavailable" ? unavailable() : ambiguous();
        }
        case "branch_create":
          return executed(
            done,
            await ensureBranch(git.runner, git.repository, {
              base: effect2.params.baseOid,
              branch: effect2.params.branchRef
            })
          );
        case "worktree_create": {
          const base = worktreeBase(effect2, run2);
          if (base === void 0) return ambiguous();
          return executed(
            done,
            await ensureWorktree(git.runner, git.repository, {
              branch: effect2.params.branchRef,
              head: base,
              path: effect2.params.worktreePath
            })
          );
        }
        case "publish": {
          const configuredRemote = remote(options);
          if (configuredRemote === void 0 || !canPublish(effect2))
            return ambiguous();
          return executed(
            done,
            await publishCandidate(git.runner, git.repository, {
              candidate: effect2.params.candidate.headOid,
              remote: configuredRemote,
              remoteBranch: effect2.params.branchRef
            })
          );
        }
        case "integrate": {
          if (effect2.params.integrationProfile === "local-ff")
            return executed(
              done,
              await integrateLocalFastForward(git.runner, git.repository, {
                base: effect2.params.candidate.baseOid,
                candidate: effect2.params.candidate.headOid,
                integrationRef: localIntegrationRef(
                  effect2.params.integrationBranch
                )
              })
            );
          const configuredRemote = remote(options);
          if (effect2.params.integrationProfile !== "remote-ff" || configuredRemote === void 0)
            return ambiguous();
          return executed(
            done,
            await integrateRemoteFastForward(git.runner, git.repository, {
              base: effect2.params.candidate.baseOid,
              candidate: effect2.params.candidate.headOid,
              integrationBranch: effect2.params.integrationBranch,
              remote: configuredRemote
            })
          );
        }
        case "candidate_collect":
        default:
          return ambiguous();
      }
    } catch {
      return ambiguous();
    }
  }
  return { execute, reconcile: discover };
}
function createProductionRecoveryRunner(options) {
  const { git, topology, ...recovery } = options;
  return createRecoveryRunner({
    ...recovery,
    adapter: createProductionRecoveryEffectAdapter({
      git,
      ...topology === void 0 ? {} : { topology }
    }),
    ...topology?.prepareControllerTransition === void 0 ? {} : {
      prepareControllerTransition: async (input) => await topology.prepareControllerTransition({
        holder: input.holder,
        kind: input.kind,
        scope: input.scope
      })
    },
    proveTopology: async () => {
      let proof;
      try {
        proof = await recovery.proveTopology();
      } catch {
        return void 0;
      }
      if (proof === void 0 || proof.commonDir !== git.repository.commonDir || proof.scope.gitRepositoryIdentity !== git.repository.identity)
        return void 0;
      if (recovery.initialRun !== void 0 && (recovery.initialRun.controller.holder !== proof.holder || recovery.initialRun.repositoryIdentity !== proof.scope.gitRepositoryIdentity || recovery.initialRun.gitObjectFormat !== git.repository.objectFormat || recovery.initialRun.storeIdentity !== proof.scope.beadsStoreIdentity || recovery.initialRun.integrationBranch !== proof.scope.integrationBranch))
        return void 0;
      const verified = await verifyRepository(git.runner, git.repository);
      return verified.state === "observed" ? proof : void 0;
    }
  });
}
function discovered(observedResult, result2) {
  const classification = classifyDiscovery(result2);
  return classification === "observed" ? observedResult : classification === "absent" ? { status: "absent" } : ambiguous();
}
function executed(observedResult, result2) {
  return result2.state === "observed" ? observedResult : ambiguous();
}

// src/commands/index.ts
var commandNames = [
  "inspect",
  "acquire-controller",
  "next",
  "plan-wave",
  "prepare-wave",
  "dispatch-request",
  "record-dispatch",
  "collect-candidate",
  "qualify",
  "review-prepare",
  "review-record",
  "publish",
  "integrate",
  "gate-wave",
  "resume",
  "status",
  "release-controller",
  "feedback"
];
var feedbackActions = [
  "prepare",
  "preview",
  "submit",
  "flush"
];
var MAX_CLI_REQUEST_BYTES = 128 * 1024;
var MAX_CLI_RESPONSE_BYTES = 128 * 1024;
var MAX_JSON_ITEMS = 256;
var MAX_TEXT = 8192;
function strictObject4(properties) {
  return Type.Object(properties, { additionalProperties: false });
}
var JsonValueSchema = Type.Recursive(
  (self) => Type.Union([
    Type.Null(),
    Type.Boolean(),
    Type.Number(),
    Type.String({ maxLength: MAX_TEXT }),
    Type.Array(self, { maxItems: MAX_JSON_ITEMS }),
    Type.Record(Type.String({ maxLength: 160 }), self, {
      maxProperties: MAX_JSON_ITEMS
    })
  ])
);
var JsonObjectSchema = Type.Record(
  Type.String({ maxLength: 160 }),
  JsonValueSchema,
  { maxProperties: MAX_JSON_ITEMS }
);
var FeedbackActionSchema = Type.Union([
  Type.Literal("prepare"),
  Type.Literal("preview"),
  Type.Literal("submit"),
  Type.Literal("flush")
]);
var RequestMetadataSchema = {
  expectedRevision: Type.Optional(
    Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  ),
  idempotencyKey: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 160,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
    })
  ),
  json: Type.Boolean()
};
var StateRequestSchema = strictObject4({ run: RepositoryRunSchema });
var StateOptionsSchema = strictObject4({
  ...RequestMetadataSchema,
  request: StateRequestSchema
});
var NoPayloadOptionsSchema = strictObject4(RequestMetadataSchema);
var RecoveryPayloadSchema = strictObject4({
  event: Type.Optional(ProtocolEventSchema)
});
var RecoveryOptionsSchema = strictObject4({
  ...RequestMetadataSchema,
  request: Type.Optional(RecoveryPayloadSchema)
});
var StateCommandSchema = strictObject4({
  command: Type.Union([
    Type.Literal("inspect"),
    Type.Literal("next"),
    Type.Literal("status")
  ]),
  options: Type.Union([StateOptionsSchema, NoPayloadOptionsSchema]),
  schema: Type.Literal("sce.command.request"),
  version: Type.Literal(1)
});
var FeedbackCommandSchema = strictObject4({
  command: Type.Literal("feedback"),
  feedbackAction: FeedbackActionSchema,
  options: NoPayloadOptionsSchema,
  schema: Type.Literal("sce.command.request"),
  version: Type.Literal(1)
});
var UnavailableCommandSchema = strictObject4({
  command: Type.Union([
    Type.Literal("acquire-controller"),
    Type.Literal("plan-wave"),
    Type.Literal("prepare-wave"),
    Type.Literal("dispatch-request"),
    Type.Literal("record-dispatch"),
    Type.Literal("collect-candidate"),
    Type.Literal("qualify"),
    Type.Literal("review-prepare"),
    Type.Literal("review-record"),
    Type.Literal("publish"),
    Type.Literal("integrate"),
    Type.Literal("gate-wave"),
    Type.Literal("resume"),
    Type.Literal("release-controller")
  ]),
  options: RecoveryOptionsSchema,
  schema: Type.Literal("sce.command.request"),
  version: Type.Literal(1)
});
var CommandRequestSchema = Type.Union([
  StateCommandSchema,
  FeedbackCommandSchema,
  UnavailableCommandSchema
]);
var CommandRunnerResultSchema = Type.Union([
  strictObject4({
    result: JsonObjectSchema,
    schema: Type.Literal("sce.command.result"),
    status: Type.Literal("ok"),
    version: Type.Literal(1)
  }),
  strictObject4({
    code: Type.Literal("SCE_INVALID_STATE_REQUEST"),
    status: Type.Literal("invalid"),
    schema: Type.Literal("sce.command.result"),
    version: Type.Literal(1)
  }),
  strictObject4({
    schema: Type.Literal("sce.command.result"),
    status: Type.Literal("unavailable"),
    version: Type.Literal(1)
  }),
  strictObject4({
    code: Type.Literal("SCE_RECOVERY_BLOCKED"),
    schema: Type.Literal("sce.command.result"),
    status: Type.Literal("blocked"),
    version: Type.Literal(1)
  })
]);
var ajv4 = new import_ajv4.Ajv({
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
  strict: true
});
var utf87 = new TextEncoder();
ajv4.addKeyword({
  keyword: "maxUtf8Bytes",
  type: "string",
  schemaType: "number",
  validate: (limit, value) => utf87.encode(value).byteLength <= limit,
  errors: false
});
var requestValidator = ajv4.compile(
  CommandRequestSchema
);
var runnerResultValidator = ajv4.compile(
  CommandRunnerResultSchema
);
function validateCommandRequest(input) {
  return requestValidator(input);
}
function validateCommandRunnerResult(input) {
  return runnerResultValidator(input);
}
function validateCommandPayload(input) {
  return isJsonObject(input) && ajv4.validate(JsonObjectSchema, input);
}
var stateOnlyCommandRunner = (request) => {
  if (!validateCommandRequest(request)) return invalidStateRequest();
  if (!isStateCommandRequest(request)) return unavailable2();
  if (!("request" in request.options)) return invalidStateRequest();
  const parsedRun = validate(
    RepositoryRunSchema,
    request.options.request.run
  );
  if (!parsedRun.ok || parsedRun.value === void 0)
    return invalidStateRequest();
  const run2 = parsedRun.value;
  if (runInvariantErrors(run2).length > 0) return invalidStateRequest();
  const ambiguities = ambiguityRecoveryActions(run2).flatMap(
    (action) => action.effectId === void 0 || action.effectKind === void 0 ? [] : [
      {
        effectId: action.effectId,
        effectKind: action.effectKind,
        observationType: action.type,
        unitId: action.unitId ?? null
      }
    ]
  );
  if (request.command === "inspect") {
    return {
      schema: "sce.command.result",
      version: 1,
      status: "ok",
      result: {
        ambiguities,
        integrationBranch: run2.integrationBranch,
        repositoryIdentity: run2.repositoryIdentity,
        revision: run2.revision,
        state: run2.state,
        unitCount: Object.keys(run2.units).length
      }
    };
  }
  if (request.command === "status") {
    return {
      schema: "sce.command.result",
      version: 1,
      status: "ok",
      result: {
        activeModifyingUnitIds: [...run2.activeModifyingUnitIds].sort(),
        ambiguities,
        effectCount: run2.effectJournal.length,
        revision: run2.revision,
        state: run2.state
      }
    };
  }
  return {
    schema: "sce.command.result",
    version: 1,
    status: "ok",
    result: {
      legalActions: legalActions(run2).map((action) => ({
        ...action
      })),
      revision: run2.revision
    }
  };
};
var commandEvent = {
  "acquire-controller": ["controller_acquire_intent"],
  "prepare-wave": ["reservation_intent", "branch_intent", "worktree_intent"],
  "dispatch-request": ["dispatch_intent"],
  "record-dispatch": ["dispatch_observed"],
  "collect-candidate": ["candidate_intent"],
  qualify: ["verification_intent"],
  "review-prepare": ["reviewer_dispatch_intent"],
  "review-record": ["review_collected"],
  publish: ["publish_intent"],
  integrate: ["integrate_intent"],
  "release-controller": ["controller_release_intent"]
};
function createRecoveryCommandRunner(runner) {
  return async (request) => {
    if (!validateCommandRequest(request)) return invalidStateRequest();
    if (isStateCommandRequest(request)) {
      const outcome2 = await runner();
      if (!("run" in outcome2))
        return outcome2.status === "unavailable" ? unavailable2() : recoveryBlocked();
      return await stateResult(request.command, outcome2.run);
    }
    if (request.command === "feedback") return unavailable2();
    const payload = request.options.request;
    const event = payload?.event;
    const expected = commandEvent[request.command];
    if (expected !== void 0 && (event === void 0 || !expected.includes(event.type)))
      return invalidStateRequest();
    if (expected === void 0 && event !== void 0)
      return invalidStateRequest();
    if (event !== void 0 && (request.options.expectedRevision !== void 0 && request.options.expectedRevision !== event.expectedRevision || request.options.idempotencyKey !== void 0 && (!("idempotencyKey" in event) || request.options.idempotencyKey !== event.idempotencyKey)))
      return invalidStateRequest();
    const outcome = await runner(event);
    if (!("revision" in outcome) || outcome.revision < 0)
      return outcome.status === "unavailable" ? unavailable2() : recoveryBlocked();
    return {
      result: {
        revision: outcome.revision,
        status: outcome.status
      },
      schema: "sce.command.result",
      status: "ok",
      version: 1
    };
  };
}
function createProductionRecoveryCommandRunner(options) {
  return createRecoveryCommandRunner(createProductionRecoveryRunner(options));
}
function recoveryBlocked() {
  return {
    code: "SCE_RECOVERY_BLOCKED",
    schema: "sce.command.result",
    status: "blocked",
    version: 1
  };
}
async function stateResult(command, run2) {
  const request = {
    command,
    options: { json: true, request: { run: run2 } },
    schema: "sce.command.request",
    version: 1
  };
  return await stateOnlyCommandRunner(request);
}
function isStateCommandRequest(request) {
  return request.command === "inspect" || request.command === "next" || request.command === "status";
}
function invalidStateRequest() {
  return {
    code: "SCE_INVALID_STATE_REQUEST",
    schema: "sce.command.result",
    status: "invalid",
    version: 1
  };
}
function unavailable2() {
  return { schema: "sce.command.result", status: "unavailable", version: 1 };
}
function isCommandName(value) {
  return commandNames.includes(value);
}
function isFeedbackAction(value) {
  return feedbackActions.includes(value);
}
function isJsonObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

// src/controller-config.ts
import { readFile } from "node:fs/promises";
import { isAbsolute as isAbsolute6, normalize as normalize3, resolve as resolve3 } from "node:path";

// src/adapters/beads-embedded/schemas.ts
var PINNED_BD_ISSUE_BASE_KEYS = [
  "acceptance_criteria",
  "actor",
  "agent_state",
  "await_id",
  "await_type",
  "close_reason",
  "closed_by_session",
  "compaction_level",
  "content_hash",
  "created_at",
  "created_by",
  "description",
  "design",
  "ephemeral",
  "event_kind",
  "external_ref",
  "hook_bead",
  "id",
  "is_blocked",
  "is_template",
  "issue_type",
  "metadata",
  "mol_type",
  "no_history",
  "notes",
  "owner",
  "payload",
  "pinned",
  "priority",
  "rig",
  "role_bead",
  "role_type",
  "sender",
  "source_repo",
  "source_system",
  "spec_id",
  "status",
  "target",
  "timeout_ns",
  "title",
  "updated_at",
  "waiters",
  "wisp_type",
  "work_type"
];
var PINNED_BD_ISSUE_NUMERIC_KEYS = [
  "compaction_level",
  "ephemeral",
  "is_blocked",
  "is_template",
  "no_history",
  "pinned",
  "priority",
  "timeout_ns"
];
var PINNED_BD_ISSUE_STRING_KEYS = [
  "acceptance_criteria",
  "actor",
  "agent_state",
  "await_id",
  "await_type",
  "close_reason",
  "closed_by_session",
  "content_hash",
  "created_by",
  "description",
  "design",
  "event_kind",
  "external_ref",
  "hook_bead",
  "mol_type",
  "notes",
  "owner",
  "payload",
  "rig",
  "role_bead",
  "role_type",
  "sender",
  "source_repo",
  "source_system",
  "spec_id",
  "target",
  "waiters",
  "wisp_type",
  "work_type"
];
function exactKeys(value, expected) {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
function sqlTimestamp(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(value);
}
function isPinnedBdIssueRow(value) {
  const hasStartedAt = Object.prototype.hasOwnProperty.call(
    value,
    "started_at"
  );
  const hasExternalRef = Object.prototype.hasOwnProperty.call(
    value,
    "external_ref"
  );
  const baseKeys = hasExternalRef ? PINNED_BD_ISSUE_BASE_KEYS : PINNED_BD_ISSUE_BASE_KEYS.filter((key) => key !== "external_ref");
  const keys = hasStartedAt ? [...baseKeys, "started_at"] : baseKeys;
  return exactKeys(value, keys) && typeof value.id === "string" && typeof value.issue_type === "string" && typeof value.status === "string" && typeof value.title === "string" && value.metadata !== null && typeof value.metadata === "object" && !Array.isArray(value.metadata) && PINNED_BD_ISSUE_STRING_KEYS.filter(
    (key) => hasExternalRef || key !== "external_ref"
  ).every((key) => typeof value[key] === "string") && PINNED_BD_ISSUE_NUMERIC_KEYS.every(
    (key) => typeof value[key] === "number" && Number.isSafeInteger(value[key])
  ) && sqlTimestamp(value.created_at) && sqlTimestamp(value.updated_at) && (!hasStartedAt || sqlTimestamp(value.started_at));
}
var EMBEDDED_ADAPTER_VERSION = 1;
var EmbeddedResultSchema = Type.Object(
  {
    code: Type.Union([
      Type.Literal("applied"),
      Type.Literal("blocked"),
      Type.Literal("stale"),
      Type.Literal("holder_mismatch"),
      Type.Literal("conflict"),
      Type.Literal("ambiguous"),
      Type.Literal("unavailable"),
      Type.Literal("quarantined"),
      Type.Literal("worker_mutation")
    ]),
    schema: Type.Literal("sce.beads-embedded.result"),
    version: Type.Literal(EMBEDDED_ADAPTER_VERSION)
  },
  { additionalProperties: false }
);

// src/adapters/beads-embedded/slot-transition.ts
function same3(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}
function head(value) {
  return typeof value === "string" && /^[0-9a-z]{20,64}$/u.test(value);
}
function holder2(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value);
}
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function transitionPayload(input) {
  return {
    after: input.after,
    before: input.before,
    holder: input.holder,
    kind: input.kind,
    schema: input.schema,
    scope: input.scope,
    version: input.version
  };
}
function deriveSlotTransitionId(input) {
  return sha256(
    canonicalJson({
      domain: "sce.beads-embedded.slot-transition.v1",
      transition: transitionPayload(input)
    })
  );
}
function makeSlotTransitionIntent(kind, holderValue, scope, before, after) {
  const unsigned = {
    after,
    before,
    holder: holderValue,
    kind,
    schema: "sce.beads-embedded.slot-transition",
    scope,
    version: 1
  };
  return { ...unsigned, idempotencyKey: deriveSlotTransitionId(unsigned) };
}
function validateSlotTransitionIntent(input, prefix, scope, mode, expectedHolder) {
  const value = object(input);
  if (value === void 0 || Object.keys(value).some(
    (key) => ![
      "after",
      "before",
      "holder",
      "idempotencyKey",
      "kind",
      "schema",
      "scope",
      "version"
    ].includes(key)
  ) || value.schema !== "sce.beads-embedded.slot-transition" || value.version !== 1 || value.kind !== "acquire" && value.kind !== "release" || !holder2(value.holder) || expectedHolder !== void 0 && value.holder !== expectedHolder || !same3(value.scope, scope) || typeof value.idempotencyKey !== "string" || !/^[0-9a-f]{64}$/u.test(value.idempotencyKey))
    return false;
  const before = object(value.before);
  if (before === void 0 || Object.keys(before).some(
    (key) => key !== "head" && key !== "remoteHead" && key !== "slot"
  ) || !head(before.head) || before.remoteHead !== void 0 && !head(before.remoteHead) || mode === "git-sync" && before.remoteHead === void 0)
    return false;
  const beforeSlot = validateMergeSlotObservation(before.slot, prefix, scope);
  const afterSlot = validateMergeSlotObservation(value.after, prefix, scope);
  if (!beforeSlot.ok || !afterSlot.ok) return false;
  const intended = value.kind === "acquire" ? beforeSlot.value.status === "available" && afterSlot.value.status === "acquired" && afterSlot.value.actor === value.holder && afterSlot.value.holder === value.holder : beforeSlot.value.status === "acquired" && beforeSlot.value.actor === value.holder && beforeSlot.value.holder === value.holder && afterSlot.value.status === "available" && afterSlot.value.actor === value.holder;
  if (!intended) return false;
  const unsigned = {
    after: afterSlot.value,
    before: {
      head: before.head,
      ...before.remoteHead === void 0 ? {} : { remoteHead: before.remoteHead },
      slot: beforeSlot.value
    },
    holder: value.holder,
    kind: value.kind,
    schema: value.schema,
    scope,
    version: value.version
  };
  return value.idempotencyKey === deriveSlotTransitionId(unsigned);
}

// src/adapters/beads-embedded/pinned-bd-process.ts
import { spawn as spawn2 } from "node:child_process";
import { createHash as createHash2 } from "node:crypto";
import { closeSync as closeSync2, openSync as openSync2, readSync, realpathSync as realpathSync3, statSync as statSync2 } from "node:fs";
import { basename as basename2, dirname as dirname2, isAbsolute as isAbsolute3 } from "node:path";
var MAX_OUTPUT_BYTES = 65536;
var PINNED_BD_VERSION = "1.1.0";
var PINNED_DOLT_VERSION = "2.2.1";
var PROCESS_TIMEOUT_MS = 15e3;
var EXECUTABLE_SAMPLE_BYTES = 65536;
var MAX_CLONE_LINEAGE_EDGES = 64;
var SLOT_INITIALIZATION_AUTHORITY = "sce.embedded.slot.initialize.v1";
function sameExecutable(left, right) {
  return left !== void 0 && left.ctimeMs === right.ctimeMs && left.dev === right.dev && left.digest === right.digest && left.ino === right.ino && left.mtimeMs === right.mtimeMs && left.mode === right.mode && left.path === right.path && left.size === right.size;
}
function executableDigest(path2, size) {
  if (!Number.isSafeInteger(size) || size < 0) return void 0;
  let descriptor;
  try {
    descriptor = openSync2(path2, "r");
    const hash3 = createHash2("sha256").update(`${size}:`);
    const sample = Math.min(size, EXECUTABLE_SAMPLE_BYTES);
    const first = Buffer.alloc(sample);
    if (sample > 0)
      hash3.update(first.subarray(0, readSync(descriptor, first, 0, sample, 0)));
    if (size > sample) {
      const last = Buffer.alloc(sample);
      hash3.update(
        last.subarray(
          0,
          readSync(descriptor, last, 0, sample, Math.max(0, size - sample))
        )
      );
    }
    return hash3.digest("hex");
  } catch {
    return void 0;
  } finally {
    if (descriptor !== void 0) closeSync2(descriptor);
  }
}
function safeString(value, max = 160) {
  return typeof value === "string" && value.length > 0 && value.length <= max && !value.includes("\0") ? value : void 0;
}
function safeHead(value) {
  const head3 = safeString(value, 64);
  return head3 !== void 0 && /^[0-9a-z]{20,64}$/u.test(head3) ? head3 : void 0;
}
function object2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function json2(source) {
  try {
    return object2(JSON.parse(source));
  } catch {
    return void 0;
  }
}
function doltShow(source) {
  const raw = json2(source);
  if (raw === void 0 || raw.backend !== "dolt" || raw.embedded !== true || raw.schema_version !== 1)
    return void 0;
  const dataDir = safeString(raw.data_dir, 4096);
  const database = safeString(raw.database);
  return dataDir === void 0 || database === void 0 ? void 0 : { dataDir, database };
}
function autoCommit(source) {
  const raw = json2(source);
  if (raw === void 0 || raw.key !== "dolt.auto-commit" || raw.schema_version !== 1)
    return void 0;
  return raw.value === "off" || raw.value === "on" || raw.value === "batch" ? raw.value : void 0;
}
function sqlRows(source) {
  const raw = json2(source);
  if (raw !== void 0 && Object.keys(raw).length === 0) return [];
  return raw !== void 0 && Array.isArray(raw.rows) && raw.rows.every((row) => object2(row) !== void 0) ? raw.rows : void 0;
}
function sqlHead(source) {
  const rows = sqlRows(source);
  return rows?.length === 1 ? safeHead(rows[0]?.head) : void 0;
}
function sqlWorkingSet(source) {
  const rows = sqlRows(source);
  if (rows === void 0) return void 0;
  return rows.length === 0 ? "clean" : rows.every(
    (row) => row.staged === 0 && typeof row.status === "string" && safeString(row.table_name) !== void 0
  ) ? "pending" : void 0;
}
function isPinnedCloneMergeDelta(source) {
  const raw = json2(source);
  if (raw === void 0 || Object.keys(raw).length !== 1 || Object.keys(raw)[0] !== "tables")
    return false;
  const tables = raw?.tables;
  if (!Array.isArray(tables) || tables.length !== 1) return false;
  const table = object2(tables[0]);
  const diffs = table?.data_diff;
  if (table === void 0 || Object.keys(table).length !== 2 || !Object.prototype.hasOwnProperty.call(table, "name") || !Object.prototype.hasOwnProperty.call(table, "data_diff") || table.name !== "metadata" || !Array.isArray(diffs) || diffs.length !== 2)
    return false;
  const seen = /* @__PURE__ */ new Set();
  for (const diff of diffs) {
    const entry = object2(diff);
    const from = object2(entry?.from_row);
    const to = object2(entry?.to_row);
    if (entry === void 0 || Object.keys(entry).length !== 2 || !Object.prototype.hasOwnProperty.call(entry, "from_row") || !Object.prototype.hasOwnProperty.call(entry, "to_row") || from === void 0 || to === void 0 || Object.keys(from).length !== 2 || Object.keys(to).length !== 2 || Object.keys(from).some((key) => key !== "key" && key !== "value") || Object.keys(to).some((key) => key !== "key" && key !== "value") || from.key !== to.key || typeof from.key !== "string" || seen.has(from.key) || typeof from.value !== "string" || typeof to.value !== "string" || from.value === to.value)
      return false;
    seen.add(from.key);
    if (from.key === "clone_id" && (!/^[0-9a-f]{16}$/u.test(from.value) || !/^[0-9a-f]{16}$/u.test(to.value)) || from.key === "last_import_time" && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      from.value
    ) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      to.value
    )))
      return false;
  }
  return seen.size === 2 && seen.has("clone_id") && seen.has("last_import_time");
}
var SLOT_ISSUE_BASE_KEYS = [
  "acceptance_criteria",
  "actor",
  "agent_state",
  "await_id",
  "await_type",
  "close_reason",
  "closed_by_session",
  "compaction_level",
  "content_hash",
  "created_at",
  "created_by",
  "description",
  "design",
  "ephemeral",
  "event_kind",
  "external_ref",
  "hook_bead",
  "id",
  "is_blocked",
  "is_template",
  "issue_type",
  "metadata",
  "mol_type",
  "no_history",
  "notes",
  "owner",
  "payload",
  "pinned",
  "priority",
  "rig",
  "role_bead",
  "role_type",
  "sender",
  "source_repo",
  "source_system",
  "spec_id",
  "status",
  "target",
  "timeout_ns",
  "title",
  "updated_at",
  "waiters",
  "wisp_type",
  "work_type"
];
var SLOT_ISSUE_NUMERIC_KEYS = [
  "compaction_level",
  "ephemeral",
  "is_blocked",
  "is_template",
  "no_history",
  "pinned",
  "priority",
  "timeout_ns"
];
var SLOT_ISSUE_STRING_KEYS = [
  "acceptance_criteria",
  "actor",
  "agent_state",
  "await_id",
  "await_type",
  "close_reason",
  "closed_by_session",
  "content_hash",
  "created_by",
  "description",
  "design",
  "event_kind",
  "external_ref",
  "hook_bead",
  "mol_type",
  "notes",
  "owner",
  "payload",
  "rig",
  "role_bead",
  "role_type",
  "sender",
  "source_repo",
  "source_system",
  "spec_id",
  "target",
  "waiters",
  "wisp_type",
  "work_type"
];
var EVENT_ROW_KEYS = [
  "actor",
  "created_at",
  "event_type",
  "id",
  "issue_id",
  "new_value",
  "old_value"
];
var EVENT_OLD_BASE_KEYS = [
  "created_at",
  "description",
  "design",
  "external_ref",
  "id",
  "issue_type",
  "labels",
  "priority",
  "status",
  "title",
  "updated_at"
];
function hasExactKeys(value, expected) {
  const actual = Object.keys(value);
  return actual.length === expected.length && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
function sameJson(left, right) {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}
function sqlTimestamp2(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(value);
}
function eventTimestamp(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value);
}
function eventId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
    value
  );
}
function jsonObjectString(value) {
  if (typeof value !== "string") return void 0;
  try {
    return object2(JSON.parse(value));
  } catch {
    return void 0;
  }
}
function exactSlotMetadata(value, holder4) {
  const metadata = object2(value);
  return metadata !== void 0 && hasExactKeys(metadata, holder4 === void 0 ? [] : ["holder"]) && (holder4 === void 0 || metadata.holder === holder4);
}
function exactSlotIssueRow(row, expectedId, status, holder4, hasStartedAt) {
  const expectedKeys = hasStartedAt ? [...SLOT_ISSUE_BASE_KEYS, "started_at"] : SLOT_ISSUE_BASE_KEYS;
  return isPinnedBdIssueRow(row) && hasExactKeys(row, expectedKeys) && row.id === expectedId && row.issue_type === "task" && row.status === status && row.title === MERGE_SLOT_TITLE && exactSlotMetadata(row.metadata, holder4) && SLOT_ISSUE_STRING_KEYS.every((key) => typeof row[key] === "string") && SLOT_ISSUE_NUMERIC_KEYS.every(
    (key) => typeof row[key] === "number" && Number.isSafeInteger(row[key])
  ) && sqlTimestamp2(row.created_at) && sqlTimestamp2(row.updated_at) && (!hasStartedAt || sqlTimestamp2(row.started_at));
}
function exactPriorEventValue(value, issue, beforeHolder, hasStartedAt) {
  const expectedKeys = [
    ...EVENT_OLD_BASE_KEYS,
    ...beforeHolder === void 0 ? [] : ["metadata"],
    ...hasStartedAt ? ["started_at"] : []
  ];
  return hasExactKeys(value, expectedKeys) && value.id === issue.id && value.title === issue.title && value.description === issue.description && value.design === issue.design && value.status === issue.status && value.priority === issue.priority && value.issue_type === issue.issue_type && value.external_ref === issue.external_ref && eventTimestamp(value.created_at) && eventTimestamp(value.updated_at) && (!hasStartedAt || eventTimestamp(value.started_at)) && Array.isArray(value.labels) && value.labels.length === 1 && value.labels[0] === MERGE_SLOT_LABEL && (beforeHolder === void 0 || exactSlotMetadata(value.metadata, beforeHolder));
}
function exactNextEventValue(value, issue, afterHolder) {
  return hasExactKeys(value, ["metadata", "status"]) && value.status === issue.status && typeof value.metadata === "string" && exactSlotMetadata(jsonObjectString(value.metadata), afterHolder);
}
function isPinnedSlotTransitionDelta(source, prefix, intent2) {
  const raw = json2(source);
  if (raw === void 0 || !hasExactKeys(raw, ["tables"])) return false;
  const tables = raw.tables;
  if (!Array.isArray(tables) || tables.length !== 2) return false;
  const byName = /* @__PURE__ */ new Map();
  for (const table of tables) {
    const value = object2(table);
    const name = value === void 0 ? void 0 : value.name;
    if (value === void 0 || !hasExactKeys(value, ["name", "data_diff"]) || name !== "issues" && name !== "events" || byName.has(name))
      return false;
    byName.set(name, value);
  }
  const issues = byName.get("issues");
  const events = byName.get("events");
  if (issues === void 0 || events === void 0) return false;
  const issueDiffs = issues.data_diff;
  const eventDiffs = events.data_diff;
  if (!Array.isArray(issueDiffs) || issueDiffs.length !== 1 || !Array.isArray(eventDiffs) || eventDiffs.length !== 1)
    return false;
  const issue = object2(issueDiffs[0]);
  const event = object2(eventDiffs[0]);
  if (issue === void 0 || event === void 0 || !hasExactKeys(issue, ["from_row", "to_row"]) || !hasExactKeys(event, ["from_row", "to_row"]))
    return false;
  const from = object2(issue.from_row);
  const to = object2(issue.to_row);
  const eventFrom = object2(event.from_row);
  const eventTo = object2(event.to_row);
  if (from === void 0 || to === void 0 || eventFrom === void 0 || !hasExactKeys(eventFrom, []) || eventTo === void 0 || !hasExactKeys(eventTo, EVENT_ROW_KEYS) || sameJson(from, to))
    return false;
  const expectedId = `${prefix}-merge-slot`;
  const before = intent2.before.slot;
  const after = intent2.after;
  const fromStatus = before.status === "available" ? "open" : "in_progress";
  const toStatus = after.status === "available" ? "open" : "in_progress";
  const fromHasStartedAt = Object.prototype.hasOwnProperty.call(
    from,
    "started_at"
  );
  const exactFrom = exactSlotIssueRow(
    from,
    expectedId,
    fromStatus,
    before.holder,
    fromHasStartedAt
  );
  const exactTo = exactSlotIssueRow(
    to,
    expectedId,
    toStatus,
    after.holder,
    true
  );
  if (!exactFrom || !exactTo || before.status === "acquired" && !fromHasStartedAt)
    return false;
  const mutable = /* @__PURE__ */ new Set(["metadata", "started_at", "status", "updated_at"]);
  for (const key of /* @__PURE__ */ new Set([...Object.keys(from), ...Object.keys(to)])) {
    if (!mutable.has(key) && !sameJson(from[key], to[key])) return false;
  }
  const previousValue = jsonObjectString(eventTo.old_value);
  const nextValue = jsonObjectString(eventTo.new_value);
  return eventId(eventTo.id) && eventTo.issue_id === expectedId && eventTo.actor === intent2.holder && eventTo.event_type === "status_changed" && sqlTimestamp2(eventTo.created_at) && previousValue !== void 0 && exactPriorEventValue(
    previousValue,
    from,
    before.holder,
    fromHasStartedAt
  ) && nextValue !== void 0 && exactNextEventValue(nextValue, to, after.holder);
}
function parseSlotDocument(source, expectedId, expectedScope) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    return void 0;
  }
  const rows = object2(parsed)?.rows;
  const raw = Array.isArray(parsed) ? parsed.length === 1 ? object2(parsed[0]) : void 0 : Array.isArray(rows) && rows.length === 1 ? object2(rows[0]) : void 0;
  const metadata = raw === void 0 ? void 0 : raw.metadata === void 0 ? {} : object2(raw.metadata);
  const labels = raw === void 0 || !Array.isArray(raw.labels) ? void 0 : raw.labels;
  if (raw === void 0 || raw.id !== expectedId || raw.title !== MERGE_SLOT_TITLE || !Array.isArray(labels) || labels.length !== 1 || labels[0] !== MERGE_SLOT_LABEL || raw.status !== "open" && raw.status !== "in_progress" || metadata === void 0 || Object.keys(metadata).some((key) => key !== "holder") || raw.external_ref !== `sce-scope:v1:${deriveScopeCommitment(expectedScope)}` || raw.design !== canonicalJson(expectedScope))
    return void 0;
  const holder4 = metadata.holder === void 0 ? void 0 : safeString(metadata.holder, 321);
  if (metadata.holder !== void 0 && holder4 === void 0) return void 0;
  if (raw.status === "open" !== (holder4 === void 0)) return void 0;
  return {
    ...holder4 === void 0 ? {} : { holder: holder4 },
    scope: expectedScope,
    status: raw.status === "open" ? "available" : "acquired"
  };
}
function parseRemoteSlotDocument(issueSource, labelsSource, expectedId, expectedScope) {
  const rows = sqlRows(issueSource);
  const labels = sqlRows(labelsSource);
  if (rows === void 0 || rows.length !== 1 || labels === void 0 || labels.length !== 1 || labels[0]?.label !== MERGE_SLOT_LABEL)
    return void 0;
  return parseSlotDocument(
    JSON.stringify([{ ...rows[0], labels: [MERGE_SLOT_LABEL] }]),
    expectedId,
    expectedScope
  );
}
var PinnedBdEmbeddedProcess = class {
  identity;
  bdExecutable;
  cwd;
  databaseDirectory;
  doltExecutable;
  bdVersionCheck;
  bdVersionExecutable;
  bdRejectedExecutable;
  doltVersionCheck;
  doltVersionExecutable;
  doltRejectedExecutable;
  prefix;
  projections;
  remote;
  scope;
  constructor(options) {
    this.bdExecutable = options.bdExecutable;
    this.cwd = options.cwd;
    this.databaseDirectory = this.canonicalDirectory(options.databaseDirectory);
    this.doltExecutable = options.doltExecutable;
    this.prefix = options.prefix;
    this.projections = options.projections;
    this.remote = options.remote;
    this.scope = options.scope;
    const storePath = this.databaseDirectory === "" ? "" : this.canonicalDirectory(dirname2(this.databaseDirectory));
    this.identity = {
      database: this.databaseDirectory === "" ? "" : basename2(this.databaseDirectory),
      databaseDirectory: this.databaseDirectory,
      prefix: this.prefix,
      ...this.remote === void 0 ? {} : { remote: this.remote },
      storePath
    };
  }
  /** Authorized bootstrap only; normal acquire/check/release never touches it. */
  async initializeSlotScope(authority) {
    if (authority !== SLOT_INITIALIZATION_AUTHORITY)
      return this.result("quarantined");
    const before = await this.run([
      "show",
      `${this.prefix}-merge-slot`,
      "--long",
      "--json"
    ]);
    if (before === void 0 || before.code !== 0 || before.exceeded || !this.uninitializedSlot(before.stdout))
      return this.result("quarantined");
    const update = await this.run([
      "update",
      `${this.prefix}-merge-slot`,
      "--external-ref",
      `sce-scope:v1:${deriveScopeCommitment(this.scope)}`,
      "--design",
      canonicalJson(this.scope),
      "--json"
    ]);
    if (update === void 0 || update.code !== 0 || update.exceeded)
      return this.result("ambiguous");
    const after = await this.run([
      "show",
      `${this.prefix}-merge-slot`,
      "--long",
      "--json"
    ]);
    return after !== void 0 && after.code === 0 && !after.exceeded && parseSlotDocument(
      after.stdout,
      `${this.prefix}-merge-slot`,
      this.scope
    ) !== void 0 ? this.result("applied") : this.result("ambiguous");
  }
  async execute(request) {
    switch (request.kind) {
      case "state": {
        const engine = await this.run(["dolt", "status", "--json"]);
        const show = await this.run(["dolt", "show", "--json"]);
        const policy = await this.run([
          "config",
          "get",
          "dolt.auto-commit",
          "--json"
        ]);
        const shown = show === void 0 || show.code !== 0 || show.exceeded ? void 0 : doltShow(show.stdout);
        const engineOk = engine !== void 0 && engine.code === 0 && !engine.exceeded && this.engineStatus(engine.stdout);
        const configured = policy === void 0 || policy.code !== 0 || policy.exceeded ? void 0 : autoCommit(policy.stdout);
        const cwd = shown === void 0 ? void 0 : this.canonicalDirectory(`${shown.dataDir}/${shown.database}`);
        if (cwd === void 0 || cwd !== this.databaseDirectory)
          return {
            kind: "state",
            value: {
              autoCommit: "off",
              reachable: false,
              workingSet: "unknown"
            }
          };
        const head3 = cwd === void 0 ? void 0 : await this.doltHead(cwd);
        const workingSet = cwd === void 0 ? void 0 : await this.doltWorkingSet(cwd);
        const remoteHead = cwd === void 0 || this.remote === void 0 ? void 0 : await this.remoteHead(cwd, this.remote);
        return !engineOk || configured === void 0 || head3 === void 0 || workingSet === void 0 ? {
          kind: "state",
          value: {
            autoCommit: "off",
            reachable: false,
            workingSet: "unknown"
          }
        } : {
          kind: "state",
          value: {
            autoCommit: configured,
            head: head3,
            reachable: true,
            ...this.remote === void 0 || remoteHead === void 0 ? {} : { remoteHead },
            workingSet
          }
        };
      }
      case "load":
        return {
          kind: "load",
          value: this.projections.load === void 0 ? { status: "unavailable" } : await this.projections.load()
        };
      case "slot": {
        if (request.source === "remote") {
          if (request.action !== "check" || this.remote === void 0)
            throw new Error("invalid remote slot request");
          const remoteRef = await this.fetchRemoteMain(this.remote);
          const slot2 = remoteRef === void 0 ? void 0 : await this.remoteSlotAt(remoteRef, request.actor);
          if (slot2 === void 0)
            throw new Error("remote slot readback failed");
          return {
            kind: "slot",
            value: this.slotObservation(slot2, request.actor)
          };
        }
        const action = await this.run([
          "--actor",
          request.actor,
          "merge-slot",
          request.action,
          "--json"
        ]);
        if (action === void 0 || action.exceeded || action.code !== 0 && request.action === "release")
          throw new Error("pinned bd slot operation failed");
        const show = await this.run([
          "show",
          `${this.prefix}-merge-slot`,
          "--long",
          "--json"
        ]);
        const slot = show === void 0 || show.code !== 0 || show.exceeded ? void 0 : parseSlotDocument(
          show.stdout,
          `${this.prefix}-merge-slot`,
          this.scope
        );
        if (slot === void 0)
          throw new Error("pinned bd slot readback failed");
        return {
          kind: "slot",
          value: this.slotObservation(slot, request.actor)
        };
      }
      case "slot_transition":
        return {
          kind: "slot_transition",
          value: await this.proveSlotTransition(request.intent)
        };
      case "remote_slot_transition":
        return {
          kind: "remote_slot_transition",
          value: await this.proveRemoteSlotTransition(request.intent)
        };
      case "mutation":
        if (!validateMutationBatch(request.batch).ok)
          return { kind: "mutation", value: "quarantined" };
        return this.projections.mutate(request.batch);
      case "initialize":
        if (!validateMergeSlotObservation(request.slot, this.prefix, this.scope).ok || request.slot.status !== "available" || request.slot.holder !== void 0)
          return { kind: "mutation", value: "quarantined" };
        return this.projections.initialize === void 0 ? { kind: "mutation", value: "unavailable" } : this.projections.initialize(
          "sce.embedded.projection.initialize.v1",
          request.input,
          request.slot
        );
      case "preownership_mutation":
        if (!validateMutationBatch(request.batch).ok)
          return { kind: "mutation", value: "quarantined" };
        if (!validateMergeSlotObservation(request.slot, this.prefix, this.scope).ok || request.slot.status !== "available" || request.slot.holder !== void 0)
          return { kind: "mutation", value: "quarantined" };
        return this.projections.mutatePreOwnership === void 0 ? { kind: "mutation", value: "unavailable" } : this.projections.mutatePreOwnership(request.batch, request.slot);
      case "initial_commit":
        return {
          kind: "commit",
          value: await this.commitInitialProjection(request.input)
        };
      case "initial_push":
        return {
          kind: "push",
          value: await this.pushInitialProjection(request.input)
        };
      case "readback": {
        if (!validateMutationBatch(request.batch).ok)
          throw new Error("invalid readback batch");
        const value = await this.projections.readback(request.batch);
        if (value === void 0) throw new Error("projection readback failed");
        return { kind: "readback", value };
      }
      case "discover": {
        if (!validateMutationBatch(request.batch).ok)
          throw new Error("invalid recovery batch");
        const value = await this.projections.discover(request);
        if (value === void 0) throw new Error("checkpoint discovery failed");
        if (request.point !== "after_push" || this.remote === void 0)
          return {
            kind: "discover",
            value: await this.proveCheckpointDelta(request, value)
          };
        return {
          kind: "discover",
          value: await this.proveRemoteCheckpointDelta(request, value)
        };
      }
      case "commit": {
        const capture = await this.run(["dolt", request.kind, "--json"]);
        if (capture === void 0 || capture.exceeded)
          return { kind: "commit", value: "unavailable" };
        return {
          kind: "commit",
          value: capture.code === 0 ? "applied" : "ambiguous"
        };
      }
      case "pull": {
        if (this.remote === void 0)
          return { kind: "pull", value: "ambiguous" };
        const before = await this.doltHead(this.databaseDirectory);
        const workingSet = await this.doltWorkingSet(this.databaseDirectory);
        const remote2 = await this.remoteHead(
          this.databaseDirectory,
          this.remote
        );
        if (before === void 0 || remote2 === void 0 || workingSet === void 0)
          return { kind: "pull", value: "unavailable" };
        if (workingSet !== "clean") return { kind: "pull", value: "conflict" };
        if (before === remote2) return { kind: "pull", value: "applied" };
        const fastForward = await this.isAncestor(before, remote2);
        const cloneLineage = fastForward ? false : await this.provePinnedCloneLineage(before, remote2);
        if (!fastForward && !cloneLineage)
          return { kind: "pull", value: "conflict" };
        const capture = await this.run(["dolt", request.kind, "--json"]);
        if (capture === void 0 || capture.exceeded)
          return { kind: "pull", value: "unavailable" };
        const after = await this.doltHead(this.databaseDirectory);
        const afterRemote = await this.remoteHead(
          this.databaseDirectory,
          this.remote
        );
        return {
          kind: "pull",
          value: capture.code === 0 && afterRemote === remote2 && (fastForward ? after === remote2 : after !== void 0 && await this.provePinnedClonePull(
            before,
            remote2,
            after,
            cloneLineage
          )) ? "applied" : "conflict"
        };
      }
      case "push": {
        const capture = await this.run(["dolt", request.kind, "--json"]);
        if (capture === void 0 || capture.exceeded)
          return { kind: "push", value: "unavailable" };
        return {
          kind: "push",
          value: capture.code === 0 ? "applied" : "conflict"
        };
      }
    }
  }
  slotObservation(slot, actor) {
    const withoutHash = {
      // The observation actor is the durable slot holder when held; the
      // command caller is only a request identity and must not fabricate a
      // holder/actor agreement for a competing controller.
      actor: slot.holder ?? actor,
      ...slot.holder === void 0 ? {} : { holder: slot.holder },
      label: MERGE_SLOT_LABEL,
      scope: this.scope,
      scopeCommitment: deriveScopeCommitment(this.scope),
      slotId: `${this.prefix}-merge-slot`,
      status: slot.status,
      title: MERGE_SLOT_TITLE,
      version: 1
    };
    return {
      ...withoutHash,
      readbackHash: deriveSlotReadbackHash(withoutHash)
    };
  }
  /** Commit only an exact all-row initial projection delta. */
  async commitInitialProjection(input) {
    const head3 = await this.doltHead(this.databaseDirectory);
    const workingSet = await this.doltWorkingSet(this.databaseDirectory);
    if (head3 === void 0 || workingSet === void 0) return "unavailable";
    if (this.projections.matchesInitialDelta === void 0)
      return "unavailable";
    if (workingSet === "pending") {
      const diff2 = await this.runDolt(this.databaseDirectory, [
        "diff",
        "--data",
        "-r",
        "json",
        head3
      ]);
      if (diff2 === void 0 || diff2.code !== 0 || diff2.exceeded || !this.projections.matchesInitialDelta(input, diff2.stdout))
        return "ambiguous";
      const committed = await this.run(["dolt", "commit", "--json"]);
      return committed === void 0 || committed.exceeded ? "unavailable" : committed.code === 0 ? "applied" : "ambiguous";
    }
    if (workingSet !== "clean") return "ambiguous";
    const parents = await this.directParents(head3);
    if (parents === void 0 || parents.length !== 1 || parents[0] === void 0)
      return "ambiguous";
    const diff = await this.runDolt(this.databaseDirectory, [
      "diff",
      "--data",
      "-r",
      "json",
      parents[0],
      head3
    ]);
    return diff !== void 0 && diff.code === 0 && !diff.exceeded && this.projections.matchesInitialDelta(input, diff.stdout) ? "applied" : "ambiguous";
  }
  /** Push only the exact direct checkpoint whose parent is the remote head. */
  async pushInitialProjection(input) {
    if (this.remote === void 0 || this.projections.matchesInitialDelta === void 0)
      return "unavailable";
    const head3 = await this.doltHead(this.databaseDirectory);
    const remote2 = await this.remoteHead(this.databaseDirectory, this.remote);
    const workingSet = await this.doltWorkingSet(this.databaseDirectory);
    if (head3 === void 0 || remote2 === void 0 || workingSet === void 0)
      return "unavailable";
    if (workingSet !== "clean") return "ambiguous";
    if (head3 === remote2) return "applied";
    const parents = await this.directParents(head3);
    if (parents === void 0 || parents.length !== 1 || parents[0] !== remote2)
      return "ambiguous";
    const diff = await this.runDolt(this.databaseDirectory, [
      "diff",
      "--data",
      "-r",
      "json",
      remote2,
      head3
    ]);
    if (diff === void 0 || diff.code !== 0 || diff.exceeded || !this.projections.matchesInitialDelta(input, diff.stdout))
      return "ambiguous";
    const pushed = await this.run(["dolt", "push", "--json"]);
    if (pushed === void 0 || pushed.exceeded) return "unavailable";
    if (pushed.code !== 0) return "conflict";
    const after = await this.remoteHead(this.databaseDirectory, this.remote);
    return after === head3 ? "applied" : "ambiguous";
  }
  /**
   * Validates exactly the two rows a bd 1.1.0 merge-slot action is allowed to
   * create: its `issues` row and Beads' corresponding immutable `events`
   * audit record. Any other table, issue, label, or field movement is refused.
   */
  exactSlotDelta(source, intent2) {
    return isPinnedSlotTransitionDelta(source, this.prefix, intent2);
  }
  /**
   * Selected projection readback alone cannot authorize a commit: another
   * pending or committed row could be carried with it. Bind recovery to the
   * complete current working-set or one-parent commit delta.
   */
  async proveCheckpointDelta(request, discovery) {
    if (discovery.status !== "observed") return discovery;
    const head3 = await this.doltHead(this.databaseDirectory);
    const workingSet = await this.doltWorkingSet(this.databaseDirectory);
    if (head3 === void 0 || workingSet === void 0)
      return { status: "ambiguous" };
    if (workingSet === "pending") {
      const before = await this.projections.discoverAt(request, head3);
      const diff = await this.runDolt(this.databaseDirectory, [
        "diff",
        "--data",
        "-r",
        "json",
        head3
      ]);
      const proven = before?.status === "absent" && diff !== void 0 && diff.code === 0 && !diff.exceeded && this.projections.matchesBatchDelta(request.batch, diff.stdout) ? { ...discovery, baseHead: head3, head: head3 } : { status: "ambiguous" };
      return this.bindRemoteCheckpointBaseline(proven);
    }
    if (workingSet !== "clean") return { status: "ambiguous" };
    return this.bindRemoteCheckpointBaseline(
      await this.proveCommittedCheckpoint(request, discovery, head3)
    );
  }
  /** Exact one-parent checkpoint proof at a stable local or fetched ref. */
  async proveCommittedCheckpoint(request, discovery, head3) {
    if (discovery.status !== "observed" || discovery.head !== head3)
      return { status: "ambiguous" };
    const parents = await this.directParents(head3);
    if (parents === void 0 || parents.length !== 1)
      return { status: "ambiguous" };
    const parent = parents[0];
    if (parent === void 0) return { status: "ambiguous" };
    const before = await this.projections.discoverAt(request, parent);
    const diff = await this.runDolt(this.databaseDirectory, [
      "diff",
      "--data",
      "-r",
      "json",
      parent,
      head3
    ]);
    return before?.status === "absent" && diff !== void 0 && diff.code === 0 && !diff.exceeded && this.projections.matchesBatchDelta(request.batch, diff.stdout) ? { ...discovery, baseHead: parent, head: head3 } : { status: "ambiguous" };
  }
  /**
   * Remote durable authority is an exact effect commit, not merely a selected
   * projection. A clone may wrap it once in bd's pinned metadata merge; that
   * preserves the clone-local head while proving the remote effect and its
   * expected parent without accepting arbitrary later ancestry.
   */
  async proveRemoteCheckpointDelta(request, local) {
    if (this.remote === void 0 || local.status !== "observed")
      return { status: "ambiguous" };
    const localHead = await this.doltHead(this.databaseDirectory);
    const workingSet = await this.doltWorkingSet(this.databaseDirectory);
    const remoteRef = await this.fetchRemoteMain(this.remote);
    const remoteHead = remoteRef === void 0 ? void 0 : await this.doltRefHead(remoteRef);
    const remote2 = remoteRef === void 0 ? void 0 : await this.projections.discoverAt(request, remoteRef);
    if (localHead === void 0 || workingSet !== "clean" || remoteHead === void 0 || remote2 === void 0)
      return { status: "ambiguous" };
    const effect2 = await this.proveCommittedCheckpoint(
      request,
      remote2,
      remoteHead
    );
    if (effect2.status !== "observed" || local.rootCommitment !== effect2.rootCommitment || canonicalJson(local.childCommitments) !== canonicalJson(effect2.childCommitments))
      return { status: "ambiguous" };
    if (localHead === remoteHead && effect2.baseHead !== void 0)
      return {
        ...local,
        baseHead: effect2.baseHead,
        head: localHead,
        remoteHead
      };
    const parents = await this.directParents(localHead);
    if (parents === void 0 || parents.length !== 2 || parents.filter((parent) => parent === remoteHead).length !== 1)
      return { status: "ambiguous" };
    const otherParent = parents.find((parent) => parent !== remoteHead);
    const baseHead = effect2.baseHead;
    if (otherParent === void 0 || baseHead === void 0 || !await this.exactPinnedCloneDelta(remoteHead, localHead) || !await this.provePinnedCloneLineage(otherParent, baseHead))
      return { status: "ambiguous" };
    return { ...local, baseHead, head: localHead, remoteHead };
  }
  /** Verifies the exact post-pull clone merge from the pre-pull local head. */
  async provePinnedClonePull(before, remote2, after, prePullLineage) {
    const parents = await this.directParents(after);
    if (parents === void 0 || parents.length !== 2 || parents.filter((parent) => parent === remote2).length !== 1 || !parents.includes(before))
      return false;
    return prePullLineage && await this.exactPinnedCloneDelta(remote2, after);
  }
  /**
   * A checkpoint may be pushed only from the fetched remote baseline itself,
   * or from bd's exact clone-local metadata-only representation of it.
   */
  async bindRemoteCheckpointBaseline(discovery) {
    if (discovery.status !== "observed" || this.remote === void 0)
      return discovery;
    const baseHead = discovery.baseHead;
    const remoteHead = await this.remoteHead(
      this.databaseDirectory,
      this.remote
    );
    if (baseHead === void 0 || remoteHead === void 0 || !(baseHead === remoteHead || await this.isPinnedCloneBaseline(remoteHead, baseHead)))
      return { status: "ambiguous" };
    return { ...discovery, remoteHead };
  }
  /** Exact pinned clone metadata delta from a fetched remote baseline. */
  async isPinnedCloneBaseline(remoteHead, localHead) {
    if (remoteHead === localHead) return true;
    const parents = await this.directParents(localHead);
    if (parents === void 0 || parents.length !== 1 && parents.length !== 2)
      return false;
    if (parents.length === 1)
      return parents[0] === remoteHead && await this.exactPinnedCloneDelta(remoteHead, localHead);
    if (parents.filter((parent) => parent === remoteHead).length !== 1)
      return false;
    const otherParent = parents.find((parent) => parent !== remoteHead);
    return otherParent !== void 0 && await this.exactPinnedCloneDelta(remoteHead, localHead) && await this.provePinnedCloneLineage(otherParent, remoteHead);
  }
  /** The only tolerated clone-local history edge is the pinned metadata pair. */
  async exactPinnedCloneDelta(from, to) {
    const diff = await this.runDolt(this.databaseDirectory, [
      "diff",
      "--data",
      "-r",
      "json",
      from,
      to
    ]);
    return diff !== void 0 && diff.code === 0 && !diff.exceeded && isPinnedCloneMergeDelta(diff.stdout);
  }
  /**
   * Bounded, direct-parent proof of clone-only history. Every traversed edge
   * is independently the pinned metadata pair; endpoint net diffs never
   * authorize hidden add/revert history.
   */
  async provePinnedCloneLineage(localHead, authoritativeHead, depth = 0, visited = /* @__PURE__ */ new Set()) {
    if (depth >= MAX_CLONE_LINEAGE_EDGES || visited.has(localHead) || localHead === authoritativeHead)
      return false;
    visited.add(localHead);
    const parents = await this.directParents(localHead);
    if (parents === void 0 || parents.length !== 1 && parents.length !== 2)
      return false;
    const authorityParents = [];
    for (const parent of parents) {
      if (parent === authoritativeHead || await this.isAncestor(parent, authoritativeHead))
        authorityParents.push(parent);
    }
    if (authorityParents.length !== 1) return false;
    const authorityParent = authorityParents[0];
    if (authorityParent === void 0 || !await this.exactPinnedCloneDelta(authorityParent, localHead))
      return false;
    if (parents.length === 1) return true;
    const otherParent = parents.find((parent) => parent !== authorityParent);
    return otherParent !== void 0 && await this.provePinnedCloneLineage(
      otherParent,
      authorityParent,
      depth + 1,
      visited
    );
  }
  async proveSlotTransition(intent2) {
    if (!validateSlotTransitionIntent(
      intent2,
      this.prefix,
      this.scope,
      this.remote === void 0 ? "local-only" : "git-sync"
    ))
      return "ambiguous";
    const head3 = await this.doltHead(this.databaseDirectory);
    const workingSet = await this.doltWorkingSet(this.databaseDirectory);
    const show = await this.run([
      "show",
      `${this.prefix}-merge-slot`,
      "--long",
      "--json"
    ]);
    const slot = show === void 0 || show.code !== 0 || show.exceeded ? void 0 : parseSlotDocument(
      show.stdout,
      `${this.prefix}-merge-slot`,
      this.scope
    );
    if (head3 === void 0 || workingSet === void 0 || slot === void 0 || canonicalJson(this.slotObservation(slot, intent2.holder)) !== canonicalJson(intent2.after) || workingSet === "pending" && head3 !== intent2.before.head || workingSet === "clean" && head3 === intent2.before.head)
      return "absent";
    const args = workingSet === "pending" ? ["diff", "--data", "-r", "json", intent2.before.head] : ["diff", "--data", "-r", "json", intent2.before.head, head3];
    const diff = await this.runDolt(this.databaseDirectory, args);
    return diff !== void 0 && diff.code === 0 && !diff.exceeded && this.exactSlotDelta(diff.stdout, intent2) ? "observed" : "ambiguous";
  }
  /** Exact remote-AS-OF readback bound to one bounded fetch reference. */
  async remoteSlotAt(remoteRef, actor) {
    const show = await this.runDolt(this.databaseDirectory, [
      "sql",
      "-r",
      "json",
      "-q",
      `SELECT id, title, status, metadata, external_ref, design FROM issues AS OF '${remoteRef}' WHERE id = '${this.prefix}-merge-slot'`
    ]);
    const labels = await this.runDolt(this.databaseDirectory, [
      "sql",
      "-r",
      "json",
      "-q",
      `SELECT label FROM labels AS OF '${remoteRef}' WHERE issue_id = '${this.prefix}-merge-slot'`
    ]);
    const slot = show === void 0 || show.code !== 0 || show.exceeded || labels === void 0 || labels.code !== 0 || labels.exceeded ? void 0 : parseRemoteSlotDocument(
      show.stdout,
      labels.stdout,
      `${this.prefix}-merge-slot`,
      this.scope
    );
    return slot === void 0 ? void 0 : this.slotObservation(slot, actor);
  }
  async doltRefHead(ref) {
    const capture = await this.runDolt(this.databaseDirectory, [
      "sql",
      "-r",
      "json",
      "-q",
      `SELECT DOLT_HASHOF('${ref}') AS head`
    ]);
    return capture === void 0 || capture.code !== 0 || capture.exceeded ? void 0 : sqlHead(capture.stdout);
  }
  /** Strict immediate-parent list from the pinned Dolt system table. */
  async directParents(commit2) {
    if (safeHead(commit2) === void 0) return void 0;
    const capture = await this.runDolt(this.databaseDirectory, [
      "sql",
      "-r",
      "json",
      "-q",
      `SELECT parent_hash, parent_index FROM dolt_commit_ancestors WHERE commit_hash = '${commit2}' ORDER BY parent_index`
    ]);
    const rows = capture === void 0 || capture.code !== 0 || capture.exceeded ? void 0 : sqlRows(capture.stdout);
    if (rows === void 0 || rows.length === 0 || rows.length > 2)
      return void 0;
    const values = rows.map(
      (row, index) => Object.keys(row).length === 2 && Object.keys(row).every(
        (key) => key === "parent_hash" || key === "parent_index"
      ) && row.parent_index === index ? safeHead(row.parent_hash) : void 0
    );
    return values.some((value) => value === void 0) || new Set(values).size !== values.length ? void 0 : values;
  }
  /**
   * Pinned, bounded ancestry predicate. The CTE returns one exact count row,
   * so no caller can infer reachability from a partial ancestor listing.
   */
  async isAncestor(ancestor, descendant) {
    if (safeHead(ancestor) === void 0 || safeHead(descendant) === void 0)
      return false;
    const capture = await this.runDolt(this.databaseDirectory, [
      "sql",
      "-r",
      "json",
      "-q",
      `WITH RECURSIVE ancestry(parent_hash) AS (SELECT parent_hash FROM dolt_commit_ancestors WHERE commit_hash = '${descendant}' UNION SELECT edge.parent_hash FROM dolt_commit_ancestors AS edge JOIN ancestry ON edge.commit_hash = ancestry.parent_hash) SELECT COUNT(*) AS matches FROM ancestry WHERE parent_hash = '${ancestor}'`
    ]);
    if (capture === void 0 || capture.code !== 0 || capture.exceeded)
      return false;
    const raw = json2(capture.stdout);
    const rows = raw?.rows;
    const row = Array.isArray(rows) && rows.length === 1 ? object2(rows[0]) : void 0;
    return raw !== void 0 && hasExactKeys(raw, ["rows"]) && row !== void 0 && hasExactKeys(row, ["matches"]) && row.matches === 1;
  }
  remoteProof(status) {
    return {
      schema: "sce.beads-embedded.remote-slot-transition-proof",
      status,
      version: 1
    };
  }
  /**
   * A clean different clone cannot prove the whole range from the origin
   * controller's before-head to its merge head: bd adds clone-local metadata
   * during pull. First prove the remote one-parent slot effect exactly, then
   * admit only that pinned pull metadata in the local merge relation.
   */
  async proveRemoteSlotTransition(intent2) {
    if (this.remote === void 0 || !validateSlotTransitionIntent(
      intent2,
      this.prefix,
      this.scope,
      "git-sync"
    ) || intent2.before.remoteHead === void 0)
      return this.remoteProof("ambiguous");
    const localHead = await this.doltHead(this.databaseDirectory);
    const workingSet = await this.doltWorkingSet(this.databaseDirectory);
    const remoteRef = await this.fetchRemoteMain(this.remote);
    const remoteHead = remoteRef === void 0 ? void 0 : await this.doltRefHead(remoteRef);
    if (localHead === void 0 || workingSet !== "clean" || remoteRef === void 0 || remoteHead === void 0 || remoteHead === intent2.before.remoteHead)
      return this.remoteProof("absent");
    const effectParents = await this.directParents(remoteHead);
    if (effectParents === void 0 || effectParents.length !== 1 || effectParents[0] !== intent2.before.remoteHead)
      return this.remoteProof("ambiguous");
    const effectDiff = await this.runDolt(this.databaseDirectory, [
      "diff",
      "--data",
      "-r",
      "json",
      intent2.before.remoteHead,
      remoteHead
    ]);
    const remoteSlot = await this.remoteSlotAt(remoteRef, intent2.holder);
    if (effectDiff === void 0 || effectDiff.code !== 0 || effectDiff.exceeded || !this.exactSlotDelta(effectDiff.stdout, intent2) || remoteSlot === void 0 || canonicalJson(remoteSlot) !== canonicalJson(intent2.after))
      return this.remoteProof("ambiguous");
    if (localHead !== remoteHead) {
      const localParents = await this.directParents(localHead);
      if (localParents === void 0 || localParents.length !== 2 || localParents.filter((parent) => parent === remoteHead).length !== 1 || !await this.exactPinnedCloneDelta(remoteHead, localHead))
        return this.remoteProof("ambiguous");
      const otherParent = localParents.find((parent) => parent !== remoteHead);
      if (otherParent === void 0 || !await this.provePinnedCloneLineage(
        otherParent,
        intent2.before.remoteHead
      ))
        return this.remoteProof("ambiguous");
    }
    return {
      effectHead: remoteHead,
      localHead,
      remoteHead,
      schema: "sce.beads-embedded.remote-slot-transition-proof",
      status: "observed",
      version: 1
    };
  }
  async run(argv) {
    const executable = this.executable(this.bdExecutable);
    if (executable === void 0 || sameExecutable(this.bdRejectedExecutable, executable))
      return void 0;
    this.bdRejectedExecutable = void 0;
    if (!sameExecutable(this.bdVersionExecutable, executable)) {
      this.bdVersionCheck = void 0;
      this.bdVersionExecutable = executable;
    }
    this.bdVersionCheck ??= this.runOnce(executable.path, ["--version"]);
    const version = await this.bdVersionCheck;
    if (version === void 0 || version.code !== 0 || !new RegExp(
      `^bd version ${PINNED_BD_VERSION}(?: \\(Homebrew\\))?\\n?$`,
      "u"
    ).test(version.stdout))
      return void 0;
    const operational = this.executable(this.bdExecutable);
    if (operational === void 0 || !sameExecutable(executable, operational)) {
      this.bdRejectedExecutable = operational ?? executable;
      return void 0;
    }
    return this.runOnce(operational.path, argv);
  }
  async runOnce(executable, argv) {
    return new Promise((resolve5) => {
      let stdout = "";
      let bytes2 = 0;
      let exceeded = false;
      let settled = false;
      const child = spawn2(executable, argv, {
        cwd: this.cwd,
        env: {
          LANG: "C",
          LC_ALL: "C",
          PATH: `${dirname2(this.bdExecutable)}:${dirname2(this.doltExecutable)}:/usr/bin:/bin`,
          TMPDIR: process.env.TMPDIR ?? "/private/tmp",
          DARWIN_USER_TEMP_DIR: process.env.DARWIN_USER_TEMP_DIR ?? "/private/tmp",
          TZ: "UTC"
        },
        shell: false,
        stdio: ["ignore", "pipe", "ignore"]
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), PROCESS_TIMEOUT_MS);
      child.stdout.on("data", (chunk) => {
        bytes2 += chunk.byteLength;
        if (bytes2 > MAX_OUTPUT_BYTES) {
          exceeded = true;
          child.kill("SIGKILL");
        } else stdout += chunk.toString("utf8");
      });
      child.once("error", () => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve5(void 0);
        }
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve5({ code, exceeded, stdout });
        }
      });
    });
  }
  engineStatus(source) {
    const raw = json2(source);
    return raw !== void 0 && raw.mode === "embedded" && raw.schema_version === 1 && raw.data_dir_exists === true && typeof raw.data_dir === "string" && typeof raw.server_running === "boolean";
  }
  uninitializedSlot(source) {
    let parsed;
    try {
      parsed = JSON.parse(source);
    } catch {
      return false;
    }
    const issue = Array.isArray(parsed) && parsed.length === 1 ? object2(parsed[0]) : void 0;
    return issue !== void 0 && issue.id === `${this.prefix}-merge-slot` && issue.title === MERGE_SLOT_TITLE && Array.isArray(issue.labels) && issue.labels.length === 1 && issue.labels[0] === MERGE_SLOT_LABEL && (issue.external_ref === void 0 || issue.external_ref === "" || issue.external_ref === null) && (issue.design === void 0 || issue.design === "" || issue.design === null);
  }
  result(code) {
    return { code, schema: "sce.beads-embedded.result", version: 1 };
  }
  async doltHead(cwd) {
    const capture = await this.runDolt(cwd, [
      "sql",
      "-r",
      "json",
      "-q",
      'SELECT DOLT_HASHOF("HEAD") AS head'
    ]);
    return capture === void 0 || capture.code !== 0 || capture.exceeded ? void 0 : sqlHead(capture.stdout);
  }
  async doltWorkingSet(cwd) {
    const capture = await this.runDolt(cwd, [
      "sql",
      "-r",
      "json",
      "-q",
      "SELECT * FROM dolt_status"
    ]);
    return capture === void 0 || capture.code !== 0 || capture.exceeded ? void 0 : sqlWorkingSet(capture.stdout);
  }
  async remoteHead(cwd, remote2) {
    if (cwd !== this.databaseDirectory) return void 0;
    const remoteRef = await this.fetchRemoteMain(remote2);
    if (remoteRef === void 0) return void 0;
    const capture = await this.runDolt(cwd, [
      "sql",
      "-r",
      "json",
      "-q",
      `SELECT DOLT_HASHOF('${remoteRef}') AS head`
    ]);
    return capture === void 0 || capture.code !== 0 || capture.exceeded ? void 0 : sqlHead(capture.stdout);
  }
  async fetchRemoteMain(remote2) {
    if (!/^[A-Za-z0-9._-]{1,80}$/u.test(remote2.name)) return void 0;
    if (!await this.remoteIsConfigured(this.databaseDirectory, remote2))
      return void 0;
    const fetched = await this.runDolt(this.databaseDirectory, [
      "fetch",
      remote2.name
    ]);
    return fetched !== void 0 && fetched.code === 0 && !fetched.exceeded ? `${remote2.name}/main` : void 0;
  }
  async remoteIsConfigured(cwd, remote2) {
    if (!/^[A-Za-z0-9._-]{1,80}$/u.test(remote2.name) || cwd !== this.databaseDirectory)
      return false;
    const configured = await this.runDolt(cwd, ["remote", "-v"]);
    return configured !== void 0 && configured.code === 0 && !configured.exceeded && configured.stdout.split("\n").some((line) => {
      const parts = line.trim().split(/\s+/u);
      return parts.length === 2 && parts[0] === remote2.name && parts[1] === remote2.url;
    });
  }
  async runDolt(cwd, argv) {
    const executable = this.executable(this.doltExecutable);
    if (executable === void 0 || sameExecutable(this.doltRejectedExecutable, executable))
      return void 0;
    this.doltRejectedExecutable = void 0;
    if (!sameExecutable(this.doltVersionExecutable, executable)) {
      this.doltVersionCheck = void 0;
      this.doltVersionExecutable = executable;
    }
    this.doltVersionCheck ??= this.runDoltOnce(executable.path, cwd, [
      "version"
    ]);
    const version = await this.doltVersionCheck;
    if (version === void 0 || version.code !== 0 || version.stdout.split("\n", 1)[0] !== `dolt version ${PINNED_DOLT_VERSION}`)
      return void 0;
    const operational = this.executable(this.doltExecutable);
    if (operational === void 0 || !sameExecutable(executable, operational)) {
      this.doltRejectedExecutable = operational ?? executable;
      return void 0;
    }
    return this.runDoltOnce(operational.path, cwd, argv);
  }
  executable(value) {
    if (!isAbsolute3(value) || value.length > 4096 || value.includes("\0"))
      return void 0;
    try {
      const path2 = realpathSync3.native(value);
      const stat2 = statSync2(path2, { throwIfNoEntry: false });
      const digest = stat2 === void 0 ? void 0 : executableDigest(path2, stat2.size);
      return stat2 === void 0 || !stat2.isFile() || digest === void 0 ? void 0 : {
        ctimeMs: stat2.ctimeMs,
        dev: stat2.dev,
        digest,
        ino: stat2.ino,
        mtimeMs: stat2.mtimeMs,
        mode: stat2.mode,
        path: path2,
        size: stat2.size
      };
    } catch {
      return void 0;
    }
  }
  canonicalDirectory(value) {
    try {
      return realpathSync3.native(value);
    } catch {
      return "";
    }
  }
  async runDoltOnce(executable, cwd, argv) {
    return new Promise((resolve5) => {
      let stdout = "";
      let bytes2 = 0;
      let exceeded = false;
      let settled = false;
      const child = spawn2(executable, argv, {
        cwd,
        env: {
          LANG: "C",
          LC_ALL: "C",
          PATH: `${dirname2(this.bdExecutable)}:${dirname2(this.doltExecutable)}:/usr/bin:/bin`,
          TMPDIR: process.env.TMPDIR ?? "/private/tmp",
          DARWIN_USER_TEMP_DIR: process.env.DARWIN_USER_TEMP_DIR ?? "/private/tmp",
          TZ: "UTC"
        },
        shell: false,
        stdio: ["ignore", "pipe", "ignore"]
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), PROCESS_TIMEOUT_MS);
      child.stdout.on("data", (chunk) => {
        bytes2 += chunk.byteLength;
        if (bytes2 > MAX_OUTPUT_BYTES) {
          exceeded = true;
          child.kill("SIGKILL");
        } else stdout += chunk.toString("utf8");
      });
      child.once("error", () => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve5(void 0);
        }
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve5({ code, exceeded, stdout });
        }
      });
    });
  }
};

// src/adapters/beads-embedded/dolt-projections.ts
import { spawn as spawn3 } from "node:child_process";
import { createHash as createHash3 } from "node:crypto";
import { closeSync as closeSync3, openSync as openSync3, readSync as readSync2, realpathSync as realpathSync4, statSync as statSync3 } from "node:fs";
import { dirname as dirname3, isAbsolute as isAbsolute4 } from "node:path";
var MAX_OUTPUT_BYTES2 = 262144;
var TIMEOUT_MS = 15e3;
var PINNED_DOLT_VERSION2 = "2.2.1";
var EXECUTABLE_SAMPLE_BYTES2 = 65536;
function sameExecutable2(left, right) {
  return left !== void 0 && left.ctimeMs === right.ctimeMs && left.dev === right.dev && left.digest === right.digest && left.ino === right.ino && left.mtimeMs === right.mtimeMs && left.mode === right.mode && left.path === right.path && left.size === right.size;
}
function executableDigest2(path2, size) {
  if (!Number.isSafeInteger(size) || size < 0) return void 0;
  let descriptor;
  try {
    descriptor = openSync3(path2, "r");
    const hash3 = createHash3("sha256").update(`${size}:`);
    const sample = Math.min(size, EXECUTABLE_SAMPLE_BYTES2);
    const first = Buffer.alloc(sample);
    if (sample > 0)
      hash3.update(first.subarray(0, readSync2(descriptor, first, 0, sample, 0)));
    if (size > sample) {
      const last = Buffer.alloc(sample);
      hash3.update(
        last.subarray(
          0,
          readSync2(descriptor, last, 0, sample, Math.max(0, size - sample))
        )
      );
    }
    return hash3.digest("hex");
  } catch {
    return void 0;
  } finally {
    if (descriptor !== void 0) closeSync3(descriptor);
  }
}
var PROJECTION_INITIALIZATION_AUTHORITY = "sce.embedded.projection.initialize.v1";
function same4(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}
function compareCodeUnits2(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function hex(value) {
  return Buffer.from(value, "utf8").toString("hex");
}
function stringLiteral(value) {
  return `CONVERT(0x${hex(value)} USING utf8mb4)`;
}
function jsonLiteral(value) {
  return `CAST(${stringLiteral(canonicalJson(value))} AS JSON)`;
}
function parseRows(source) {
  try {
    const input = JSON.parse(source);
    if (input === null || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1 || !Array.isArray(input.rows) || !input.rows.every(
      (row) => row !== null && typeof row === "object" && !Array.isArray(row)
    ))
      return void 0;
    return input.rows;
  } catch {
    return void 0;
  }
}
function object3(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
var DoltProjectionPersistence = class {
  directory;
  rootIssueId;
  childIssueId;
  doltExecutable;
  versionCheck;
  versionExecutable;
  rejectedExecutable;
  constructor(options) {
    try {
      this.directory = realpathSync4.native(options.databaseDirectory);
    } catch {
      this.directory = "";
    }
    this.rootIssueId = options.rootIssueId;
    this.childIssueId = options.childIssueId;
    this.doltExecutable = options.doltExecutable;
  }
  async mutate(batch) {
    if (!validateMutationBatch(batch).ok)
      return { kind: "mutation", value: "quarantined" };
    const statement = this.writeStatement(batch);
    if (statement === void 0)
      return { kind: "mutation", value: "quarantined" };
    const output = await this.sql(
      `${statement}; SELECT ROW_COUNT() AS affected`
    );
    const readback = output === void 0 || this.affected(output) !== batch.changedRows.length + 1 ? void 0 : await this.readback(batch);
    if (readback === void 0) return { kind: "mutation", value: "stale" };
    return { kind: "mutation", value: "applied" };
  }
  /** Existing-root acquire intent CAS with the available slot in its SQL CAS. */
  async mutatePreOwnership(batch, slot) {
    if (!validateMutationBatch(batch).ok)
      return { kind: "mutation", value: "quarantined" };
    const statement = this.writeStatement(batch, slot);
    if (statement === void 0)
      return { kind: "mutation", value: "quarantined" };
    const output = await this.sql(
      `${statement}; SELECT ROW_COUNT() AS affected`
    );
    const readback = output === void 0 || this.affected(output) !== batch.changedRows.length + 1 ? void 0 : await this.readback(batch);
    return readback === void 0 ? { kind: "mutation", value: "stale" } : { kind: "mutation", value: "applied" };
  }
  /**
   * Authorized bootstrap only. Normal CAS never calls this and therefore
   * refuses an absent `$.sce` envelope rather than creating it lazily.
   */
  async initialize(authority, input, slot) {
    if (authority !== PROJECTION_INITIALIZATION_AUTHORITY)
      return { kind: "mutation", value: "quarantined" };
    const legacy = validateMutationBatch(input);
    if (legacy.ok) return this.initializeLegacy(legacy.value, slot);
    if (slot === void 0) return { kind: "mutation", value: "quarantined" };
    const initial = input;
    const rows = this.initialRows(initial);
    if (rows === void 0) return { kind: "mutation", value: "quarantined" };
    const ids = rows.map((row) => stringLiteral(row.issueId)).join(",");
    const absent = rows.map(
      (row) => `(id=${stringLiteral(row.issueId)} AND JSON_EXTRACT(metadata,'$.sce') IS NULL)`
    ).join(" OR ");
    const cases = rows.map(
      (row) => `WHEN ${stringLiteral(row.issueId)} THEN JSON_SET(metadata,'$.sce',${jsonLiteral(row.next)})`
    ).join(" ");
    const slotPredicate = this.availableSlotPredicate(slot);
    const source = await this.sql(
      `UPDATE issues SET metadata=CASE id ${cases} ELSE metadata END WHERE id IN (${ids}) AND (SELECT COUNT(*) FROM issues WHERE ${absent})=${rows.length}${slotPredicate}; SELECT ROW_COUNT() AS affected`
    );
    const readback = source === void 0 || this.affected(source) !== rows.length ? void 0 : await this.load();
    return readback?.status === "observed" && same4(readback.value.root, initial.root) && same4(readback.value.children, initial.children) ? { kind: "mutation", value: "applied" } : { kind: "mutation", value: "stale" };
  }
  async initializeLegacy(batch, slot) {
    const rows = this.rows(batch);
    if (rows === void 0) return { kind: "mutation", value: "quarantined" };
    const ids = rows.map((row) => stringLiteral(row.issueId)).join(",");
    const absent = rows.map(
      (row) => `(id=${stringLiteral(row.issueId)} AND JSON_EXTRACT(metadata,'$.sce') IS NULL)`
    ).join(" OR ");
    const cases = rows.map(
      (row) => `WHEN ${stringLiteral(row.issueId)} THEN JSON_SET(metadata,'$.sce',${jsonLiteral(row.next)})`
    ).join(" ");
    const source = await this.sql(
      `UPDATE issues SET metadata=CASE id ${cases} ELSE metadata END WHERE id IN (${ids}) AND (SELECT COUNT(*) FROM issues WHERE ${absent})=${rows.length}${slot === void 0 ? "" : this.availableSlotPredicate(slot)}; SELECT ROW_COUNT() AS affected`
    );
    const readback = source === void 0 || this.affected(source) !== rows.length ? void 0 : await this.readback(batch);
    return readback === void 0 ? { kind: "mutation", value: "stale" } : { kind: "mutation", value: "applied" };
  }
  /**
   * Load exactly the root and every child that root references. A malformed
   * root/child, missing child, or duplicate mapping is never absence.
   */
  async load() {
    const source = await this.sql(this.selectStatement([this.rootIssueId]));
    const records = source === void 0 ? void 0 : parseRows(source);
    if (records === void 0) return { status: "unavailable" };
    if (records.length !== 1 || records[0]?.id !== this.rootIssueId)
      return { status: "ambiguous" };
    const rootValue = records[0]?.sce;
    if (rootValue === null) return { status: "absent" };
    const rootEnvelope = object3(rootValue);
    if (rootEnvelope === void 0 || Object.keys(rootEnvelope).length !== 2 || typeof rootEnvelope.commitment !== "string" || !Object.prototype.hasOwnProperty.call(rootEnvelope, "projection"))
      return { status: "ambiguous" };
    const parsedRoot = validateRootProjection(rootEnvelope.projection);
    if (!parsedRoot.ok || parsedRoot.value.aggregateCommitment !== rootEnvelope.commitment)
      return { status: "ambiguous" };
    const childIds = parsedRoot.value.childRows.map(
      (child) => this.childIssueId(child.unitId)
    );
    if (childIds.some((id) => id === void 0) || new Set(childIds).size !== childIds.length)
      return { status: "ambiguous" };
    if (childIds.length === 0)
      return {
        status: "observed",
        value: { children: [], root: parsedRoot.value }
      };
    const childSource = await this.sql(
      this.selectStatement(childIds)
    );
    const childrenRows = childSource === void 0 ? void 0 : parseRows(childSource);
    if (childrenRows === void 0) return { status: "unavailable" };
    if (childrenRows.length !== childIds.length) return { status: "ambiguous" };
    const expected = new Map(
      parsedRoot.value.childRows.map((child) => [child.unitId, child])
    );
    const seen = /* @__PURE__ */ new Set();
    const children = [];
    for (const record2 of childrenRows) {
      if (Object.keys(record2).length !== 2 || typeof record2.id !== "string" || seen.has(record2.id) || !Object.prototype.hasOwnProperty.call(record2, "sce"))
        return { status: "ambiguous" };
      seen.add(record2.id);
      const envelope = object3(record2.sce);
      if (envelope === void 0 || Object.keys(envelope).length !== 2 || typeof envelope.commitment !== "string" || !Object.prototype.hasOwnProperty.call(envelope, "projection"))
        return { status: "ambiguous" };
      const child = validateChildProjection(envelope.projection);
      const reference = child.ok ? expected.get(child.value.unitId) : void 0;
      if (!child.ok || reference === void 0 || child.value.commitment !== envelope.commitment || this.childIssueId(child.value.unitId) !== record2.id || child.value.revision !== reference.revision || child.value.commitment !== reference.commitment || !same4(child.value.scope, parsedRoot.value.scope) || child.value.holder !== parsedRoot.value.holder || !same4(child.value.unit, parsedRoot.value.run.units[child.value.unitId]))
        return { status: "ambiguous" };
      children.push(child.value);
    }
    return children.length !== expected.size || seen.size !== childIds.length ? { status: "ambiguous" } : {
      status: "observed",
      value: {
        children: children.sort(
          (a, b) => compareCodeUnits2(a.unitId, b.unitId)
        ),
        root: parsedRoot.value
      }
    };
  }
  async readback(batch) {
    if (!validateMutationBatch(batch).ok) return void 0;
    const statement = this.readStatement(batch);
    if (statement === void 0) return void 0;
    const output = await this.sql(statement);
    return output === void 0 ? void 0 : this.parseReadback(output, batch);
  }
  async discover(request) {
    return this.discoverAt(request, void 0);
  }
  async discoverAt(request, ref) {
    if (!validateMutationBatch(request.batch).ok) return void 0;
    const actual = await this.actual(request.batch, ref);
    const head3 = await this.head(ref);
    if (actual === void 0 || head3 === void 0) return void 0;
    const rootCommitment = actual.root.aggregateCommitment;
    const childCommitments = actual.children.map((child) => child.commitment);
    if (same4(actual.root, request.batch.next.root) && same4(actual.children, request.batch.next.children))
      return { childCommitments, head: head3, rootCommitment, status: "observed" };
    return rootCommitment === request.batch.expectedAggregateCommitment && same4(
      childCommitments,
      request.batch.expectedChildren.map((child) => child.expectedCommitment)
    ) ? { head: head3, status: "absent" } : { head: head3, status: "ambiguous" };
  }
  /**
   * The selected root/child readback above establishes the requested state.
   * This companion proof establishes that a Dolt checkpoint contains no other
   * pending or committed data movement.
   */
  matchesBatchDelta(batchInput, source) {
    const batch = validateMutationBatch(batchInput);
    if (!batch.ok) return false;
    const rows = this.rows(batch.value);
    let parsed;
    try {
      parsed = JSON.parse(source);
    } catch {
      return false;
    }
    const root = object3(parsed);
    if (rows === void 0 || root === void 0 || Object.keys(root).length !== 1 || !Object.prototype.hasOwnProperty.call(root, "tables") || !Array.isArray(root.tables) || root.tables.length !== 1)
      return false;
    const table = object3(root.tables[0]);
    if (table === void 0 || Object.keys(table).length !== 2 || table.name !== "issues" || !Array.isArray(table.data_diff) || table.data_diff.length !== rows.length)
      return false;
    const expected = new Map(rows.map((row) => [row.issueId, row]));
    const seen = /* @__PURE__ */ new Set();
    for (const input of table.data_diff) {
      const diff = object3(input);
      const from = diff === void 0 ? void 0 : object3(diff.from_row);
      const to = diff === void 0 ? void 0 : object3(diff.to_row);
      if (diff === void 0 || Object.keys(diff).length !== 2 || from === void 0 || to === void 0 || typeof from.id !== "string" || from.id !== to.id || seen.has(from.id))
        return false;
      const row = expected.get(from.id);
      if (row === void 0 || !this.matchesProjectionRow(from, to, row.expectedCommitment, row.next))
        return false;
      seen.add(from.id);
    }
    return seen.size === expected.size;
  }
  /** Complete root+initial-child delta proof used before initial commit/push. */
  matchesInitialDelta(input, source) {
    const rows = this.initialRows(input);
    let parsed;
    try {
      parsed = JSON.parse(source);
    } catch {
      return false;
    }
    const table = object3(parsed)?.tables;
    const change = Array.isArray(table) && table.length === 1 ? object3(table[0])?.data_diff : void 0;
    if (rows === void 0 || !Array.isArray(table) || table.length !== 1 || object3(table[0])?.name !== "issues" || !Array.isArray(change) || change.length !== rows.length)
      return false;
    const expected = new Map(rows.map((row) => [row.issueId, row.next]));
    const seen = /* @__PURE__ */ new Set();
    for (const value of change) {
      const diff = object3(value);
      const before = diff === void 0 ? void 0 : object3(diff.from_row);
      const after = diff === void 0 ? void 0 : object3(diff.to_row);
      if (diff === void 0 || before === void 0 || after === void 0 || typeof before.id !== "string" || before.id !== after.id || seen.has(before.id) || !isPinnedBdIssueRow(before) || !isPinnedBdIssueRow(after))
        return false;
      const next = expected.get(before.id);
      const beforeMetadata = object3(before.metadata);
      const afterMetadata = object3(after.metadata);
      if (next === void 0 || beforeMetadata === void 0 || afterMetadata === void 0 || beforeMetadata.sce !== void 0 || !same4(afterMetadata.sce, next))
        return false;
      for (const key of Object.keys(before)) {
        if (key !== "metadata" && key !== "updated_at" && !same4(before[key], after[key]))
          return false;
      }
      for (const key of Object.keys(beforeMetadata)) {
        if (key !== "sce" && !same4(beforeMetadata[key], afterMetadata[key]))
          return false;
      }
      seen.add(before.id);
    }
    return seen.size === expected.size;
  }
  writeStatement(batch, slot) {
    const rows = this.rows(batch);
    if (rows === void 0) return void 0;
    const expected = rows.map(
      (row) => `(id=${stringLiteral(row.issueId)} AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.sce.commitment'))=${stringLiteral(row.expectedCommitment)})`
    ).join(" OR ");
    const cases = rows.map(
      (row) => `WHEN ${stringLiteral(row.issueId)} THEN JSON_SET(metadata,'$.sce',${jsonLiteral(row.next)})`
    ).join(" ");
    const ids = rows.map((row) => stringLiteral(row.issueId)).join(",");
    return `UPDATE issues SET metadata=CASE id ${cases} ELSE metadata END WHERE id IN (${ids}) AND (SELECT COUNT(*) FROM issues WHERE ${expected})=${rows.length}${slot === void 0 ? "" : this.availableSlotPredicate(slot)}`;
  }
  availableSlotPredicate(slot) {
    return ` AND (SELECT COUNT(*) FROM issues WHERE id=${stringLiteral(slot.slotId)} AND title=${stringLiteral(slot.title)} AND status='open' AND external_ref=${stringLiteral(`sce-scope:v1:${slot.scopeCommitment}`)} AND design=${stringLiteral(canonicalJson(slot.scope))} AND JSON_TYPE(metadata)='OBJECT' AND JSON_LENGTH(metadata)=0)=1 AND (SELECT COUNT(*) FROM labels WHERE issue_id=${stringLiteral(slot.slotId)} AND label=${stringLiteral(slot.label)})=1`;
  }
  initialRows(input) {
    const root = validateRootProjection(input.root);
    if (!root.ok) return void 0;
    const values = [];
    for (const inputChild of input.children) {
      const child = validateChildProjection(inputChild);
      if (!child.ok) return void 0;
      values.push(child.value);
    }
    values.sort((left, right) => compareCodeUnits2(left.unitId, right.unitId));
    if (values.length !== root.value.childRows.length || values.some(
      (child, index) => root.value.childRows[index]?.unitId !== child.unitId || root.value.childRows[index]?.revision !== child.revision || root.value.childRows[index]?.commitment !== child.commitment || !same4(child.scope, root.value.scope) || child.holder !== root.value.holder || !same4(child.unit, root.value.run.units[child.unitId])
    ))
      return void 0;
    const rows = [
      {
        issueId: this.rootIssueId,
        next: {
          commitment: root.value.aggregateCommitment,
          projection: root.value
        }
      },
      ...values.map((child) => {
        const issueId = this.childIssueId(child.unitId);
        return issueId === void 0 ? void 0 : {
          issueId,
          next: { commitment: child.commitment, projection: child }
        };
      })
    ];
    return rows.some((row) => row === void 0) || new Set(rows.map((row) => row?.issueId)).size !== rows.length ? void 0 : rows.sort(
      (left, right) => compareCodeUnits2(left.issueId, right.issueId)
    );
  }
  readStatement(batch) {
    const rows = this.rows(batch);
    return rows === void 0 ? void 0 : this.selectStatement(rows.map((row) => row.issueId));
  }
  selectStatement(ids) {
    return `SELECT id, JSON_EXTRACT(metadata,'$.sce') AS sce FROM issues WHERE id IN (${ids.map(stringLiteral).join(",")}) ORDER BY id`;
  }
  async actual(batch, ref) {
    const rows = this.rows(batch);
    if (rows === void 0 || ref !== void 0 && !(/^[A-Za-z0-9._-]{1,80}\/main$/u.test(ref) || /^[0-9a-z]{20,64}$/u.test(ref)))
      return void 0;
    const statement = this.selectStatement(rows.map((row) => row.issueId));
    const source = await this.sql(
      ref === void 0 ? statement : statement.replace(" FROM issues", ` FROM issues AS OF '${ref}'`)
    );
    if (source === void 0) return void 0;
    return this.projectionRows(source, batch);
  }
  rows(batch) {
    const children = batch.changedRows.map((row) => {
      const child = batch.next.children.find(
        (item) => item.unitId === row.unitId
      );
      const issueId = this.childIssueId(row.unitId);
      return child === void 0 || issueId === void 0 ? void 0 : {
        expectedCommitment: row.expectedCommitment,
        issueId,
        next: { commitment: child.commitment, projection: child }
      };
    });
    if (children.some((row) => row === void 0)) return void 0;
    return [
      {
        expectedCommitment: batch.expectedAggregateCommitment,
        issueId: this.rootIssueId,
        next: {
          commitment: batch.next.root.aggregateCommitment,
          projection: batch.next.root
        }
      },
      ...children
    ].sort((left, right) => compareCodeUnits2(left.issueId, right.issueId));
  }
  matchesProjectionRow(from, to, expectedCommitment, next) {
    if (!isPinnedBdIssueRow(from) || !isPinnedBdIssueRow(to) || Object.keys(from).length !== Object.keys(to).length || Object.keys(from).some(
      (key) => !Object.prototype.hasOwnProperty.call(to, key)
    ))
      return false;
    for (const key of Object.keys(from)) {
      if (key !== "metadata" && key !== "updated_at" && !same4(from[key], to[key]))
        return false;
    }
    if (typeof from.updated_at !== "string" || typeof to.updated_at !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(from.updated_at) || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(to.updated_at))
      return false;
    const before = object3(from.metadata);
    const after = object3(to.metadata);
    if (before === void 0 || after === void 0 || Object.keys(before).length !== Object.keys(after).length || Object.keys(before).some(
      (key) => !Object.prototype.hasOwnProperty.call(after, key)
    ))
      return false;
    for (const key of Object.keys(before)) {
      if (key !== "sce" && !same4(before[key], after[key])) return false;
    }
    const previous = object3(before.sce);
    if (previous === void 0 || Object.keys(previous).length !== 2 || previous.commitment !== expectedCommitment || !Object.prototype.hasOwnProperty.call(previous, "projection"))
      return false;
    const projection = previous.projection;
    const commitment = projection !== null && typeof projection === "object" && "unitId" in projection ? (() => {
      const valid = validateChildProjection(projection);
      return valid.ok ? valid.value.commitment : void 0;
    })() : (() => {
      const valid = validateRootProjection(projection);
      return valid.ok ? valid.value.aggregateCommitment : void 0;
    })();
    return commitment === expectedCommitment && same4(after.sce, next) && !same4(before.sce, after.sce);
  }
  parseReadback(source, batch) {
    const actual = this.projectionRows(source, batch);
    return actual === void 0 || !same4(actual.root, batch.next.root) || !same4(
      actual.children,
      [...batch.next.children].sort(
        (a, b) => compareCodeUnits2(a.unitId, b.unitId)
      )
    ) ? void 0 : actual;
  }
  /**
   * A projection read is a fixed root/affected-child set, not a loose JSON
   * blob. Parse it once for local and AS OF reads so swapped/extra rows cannot
   * become recovery authority through a different call path.
   */
  projectionRows(source, batch) {
    const expected = this.rows(batch);
    const records = parseRows(source);
    if (expected === void 0 || records === void 0 || records.length !== expected.length)
      return void 0;
    const expectedIds = new Set(expected.map((row) => row.issueId));
    if (expectedIds.size !== expected.length) return void 0;
    const seen = /* @__PURE__ */ new Set();
    let root;
    const children = [];
    for (const record2 of records) {
      if (Object.keys(record2).length !== 2 || !Object.prototype.hasOwnProperty.call(record2, "id") || !Object.prototype.hasOwnProperty.call(record2, "sce") || typeof record2.id !== "string" || !expectedIds.has(record2.id) || seen.has(record2.id))
        return void 0;
      seen.add(record2.id);
      const envelope = object3(record2.sce);
      if (envelope === void 0 || Object.keys(envelope).length !== 2 || !Object.prototype.hasOwnProperty.call(envelope, "commitment") || !Object.prototype.hasOwnProperty.call(envelope, "projection") || typeof envelope.commitment !== "string")
        return void 0;
      if (record2.id === this.rootIssueId) {
        const candidate2 = validateRootProjection(envelope.projection);
        if (!candidate2.ok || candidate2.value.aggregateCommitment !== envelope.commitment)
          return void 0;
        root = candidate2.value;
        continue;
      }
      const candidate = validateChildProjection(envelope.projection);
      if (!candidate.ok || candidate.value.commitment !== envelope.commitment || this.childIssueId(candidate.value.unitId) !== record2.id)
        return void 0;
      children.push(candidate.value);
    }
    return root === void 0 || seen.size !== expectedIds.size || children.length !== batch.changedRows.length ? void 0 : {
      children: children.sort(
        (a, b) => compareCodeUnits2(a.unitId, b.unitId)
      ),
      root
    };
  }
  async sql(query) {
    const executable = this.executable();
    if (executable === void 0 || sameExecutable2(this.rejectedExecutable, executable))
      return void 0;
    this.rejectedExecutable = void 0;
    if (!await this.pinnedVersion(executable)) return void 0;
    const operational = this.executable();
    if (operational === void 0 || !sameExecutable2(executable, operational)) {
      this.rejectedExecutable = operational ?? executable;
      return void 0;
    }
    return new Promise((resolve5) => {
      let output = "";
      let bytes2 = 0;
      let settled = false;
      const child = spawn3(
        operational.path,
        ["sql", "-r", "json", "-q", query],
        {
          cwd: this.directory,
          env: {
            LANG: "C",
            LC_ALL: "C",
            PATH: `${dirname3(this.doltExecutable)}:/usr/bin:/bin`,
            TMPDIR: process.env.TMPDIR ?? "/private/tmp",
            DARWIN_USER_TEMP_DIR: process.env.DARWIN_USER_TEMP_DIR ?? "/private/tmp",
            TZ: "UTC"
          },
          shell: false,
          stdio: ["ignore", "pipe", "ignore"]
        }
      );
      const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
      child.stdout.on("data", (chunk) => {
        bytes2 += chunk.byteLength;
        if (bytes2 > MAX_OUTPUT_BYTES2) child.kill("SIGKILL");
        else output += chunk.toString("utf8");
      });
      child.once("error", () => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve5(void 0);
        }
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve5(code === 0 && bytes2 <= MAX_OUTPUT_BYTES2 ? output : void 0);
        }
      });
    });
  }
  affected(source) {
    const rows = parseRows(source);
    const value = rows?.length === 1 ? rows[0]?.affected : void 0;
    return typeof value === "number" && Number.isSafeInteger(value) ? value : void 0;
  }
  executable() {
    if (!isAbsolute4(this.doltExecutable) || this.doltExecutable.includes("\0"))
      return void 0;
    try {
      const path2 = realpathSync4.native(this.doltExecutable);
      const stat2 = statSync3(path2, { throwIfNoEntry: false });
      const digest = stat2 === void 0 ? void 0 : executableDigest2(path2, stat2.size);
      return stat2 === void 0 || !stat2.isFile() || digest === void 0 ? void 0 : {
        ctimeMs: stat2.ctimeMs,
        dev: stat2.dev,
        digest,
        ino: stat2.ino,
        mtimeMs: stat2.mtimeMs,
        mode: stat2.mode,
        path: path2,
        size: stat2.size
      };
    } catch {
      return void 0;
    }
  }
  pinnedVersion(executable) {
    if (!sameExecutable2(this.versionExecutable, executable)) {
      this.versionCheck = void 0;
      this.versionExecutable = executable;
    }
    this.versionCheck ??= new Promise((resolve5) => {
      let output = "";
      let settled = false;
      const child = spawn3(executable.path, ["version"], {
        cwd: this.directory,
        env: {
          DARWIN_USER_TEMP_DIR: process.env.DARWIN_USER_TEMP_DIR ?? "/private/tmp",
          LANG: "C",
          LC_ALL: "C",
          PATH: `${dirname3(this.doltExecutable)}:/usr/bin:/bin`,
          TMPDIR: process.env.TMPDIR ?? "/private/tmp",
          TZ: "UTC"
        },
        shell: false,
        stdio: ["ignore", "pipe", "ignore"]
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
      child.stdout.on("data", (chunk) => {
        output += chunk.toString("utf8");
        if (Buffer.byteLength(output, "utf8") > MAX_OUTPUT_BYTES2)
          child.kill("SIGKILL");
      });
      child.once("error", () => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve5(false);
        }
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve5(
            code === 0 && output.split("\n", 1)[0] === `dolt version ${PINNED_DOLT_VERSION2}`
          );
        }
      });
    });
    return this.versionCheck;
  }
  async head(ref) {
    const source = await this.sql(
      `SELECT DOLT_HASHOF('${ref ?? "HEAD"}') AS head`
    );
    const rows = source === void 0 ? void 0 : parseRows(source);
    const value = rows?.length === 1 ? rows[0]?.head : void 0;
    return typeof value === "string" && /^[0-9a-z]{20,64}$/u.test(value) ? value : void 0;
  }
};

// src/adapters/beads-embedded/index.ts
function result(code) {
  return {
    code,
    schema: "sce.beads-embedded.result",
    version: EMBEDDED_ADAPTER_VERSION
  };
}
function same5(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}
function object4(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function head2(value) {
  return typeof value === "string" && /^[0-9a-z]{20,64}$/u.test(value);
}
function holder3(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value);
}
function checkedPreflight(preflight, identity2, mode, prefix, scope) {
  if (!isSchema(PreflightEnvelopeSchema, preflight) || !isSchema(FencingScopeSchema, scope) || preflight.payload.status !== "ready")
    return false;
  const beads = preflight.payload.beads;
  const expectedDirectory = `${identity2.storePath}/${identity2.database}`;
  if (beads.mode !== "embedded" || beads.provenance !== "embedded_config" || beads.database !== identity2.database || beads.prefix !== prefix || beads.projectId !== scope.beadsStoreIdentity || identity2.prefix !== prefix || beads.storePath !== identity2.storePath || identity2.databaseDirectory !== expectedDirectory || preflight.payload.git.identity !== scope.gitRepositoryIdentity)
    return false;
  if (mode === "local-only")
    return beads.syncRemote === void 0 && beads.syncRef === void 0 && identity2.remote === void 0;
  return identity2.remote !== void 0 && beads.syncRemote === identity2.remote.url && beads.syncRef === identity2.remote.ref;
}
var EmbeddedBeadsAdapter = class {
  holder;
  mode;
  prefix;
  process;
  scope;
  usable;
  constructor(options) {
    this.holder = options.holder;
    this.mode = options.mode;
    this.prefix = options.prefix;
    this.process = options.process;
    this.scope = options.scope;
    this.usable = checkedPreflight(
      options.preflight,
      options.process.identity,
      options.mode,
      options.prefix,
      options.scope
    );
  }
  /** Acquires only the pre-existing built-in merge slot, with exact readback. */
  async acquire(authority) {
    if (!this.usable || authority === void 0 || !this.validAcquisitionAuthority(authority) || // A holder-less acquire is necessarily mutating, so it must carry a
    // persisted plan before even a state probe is permitted.
    authority.knownHolder === void 0 && authority.transition === void 0)
      return result("quarantined");
    const initial = await this.state();
    if (initial === void 0 || !initial.reachable)
      return result("unavailable");
    if (initial.workingSet === "unknown") return result("ambiguous");
    if (initial.workingSet !== "clean" || this.mode === "git-sync" && initial.head !== initial.remoteHead) {
      if (this.mode === "git-sync" && authority.transition === void 0) {
        const remote2 = await this.slot("check", "remote");
        if (remote2 === void 0) return result("ambiguous");
        const decision2 = decideControllerSlot(
          this.prefix,
          this.scope,
          this.holder,
          authority.knownHolder,
          remote2,
          authority.continuation,
          authority.release
        );
        return decision2.kind === "blocked" ? result("blocked") : result("ambiguous");
      }
      return this.recoverSlotTransition("acquire", authority?.transition);
    }
    const before = await this.state();
    if (before === void 0 || !before.reachable || before.workingSet !== "clean" || before.head === void 0 || this.mode === "git-sync" && (before.remoteHead === void 0 || before.remoteHead !== before.head))
      return result("ambiguous");
    const check = await this.slot("check");
    if (check === void 0) return result("quarantined");
    if (authority.transition !== void 0 && same5(check, authority.transition.after))
      return this.reconcileLostSlotTransition(
        "acquire",
        authority.transition,
        before,
        check
      );
    const decision = decideControllerSlot(
      this.prefix,
      this.scope,
      this.holder,
      authority?.knownHolder,
      check,
      authority?.continuation,
      authority?.release
    );
    if (decision.kind === "blocked") return result("blocked");
    if (decision.kind === "quarantined") return result("quarantined");
    if (decision.kind === "resume" || decision.kind === "continue")
      return this.confirmDurableSlot(check);
    const transition = authority.transition;
    if (transition === void 0) return result("quarantined");
    if (!this.matchesTransitionBefore(transition, "acquire", before, check))
      return result("quarantined");
    const acquired = await this.slot("acquire");
    if (acquired === void 0) return result("quarantined");
    if (!same5(acquired, transition.after)) return result("blocked");
    return this.durableSlotTransition(transition);
  }
  /**
   * Read-only planning half of acquire. Persist its returned intent in the
   * controller journal before calling `acquire`; it is the sole authority for
   * any pending or pre-push recovery in a replacement process.
   */
  async prepareAcquireTransition(authority) {
    if (!this.usable || !this.validAcquisitionPlanningAuthority(authority))
      return result("quarantined");
    const state = await this.state();
    if (state === void 0 || !state.reachable) return result("unavailable");
    if (state.workingSet !== "clean" || state.head === void 0 || this.mode === "git-sync" && (state.remoteHead === void 0 || state.remoteHead !== state.head))
      return result("ambiguous");
    const before = await this.slot("check");
    if (before === void 0) return result("quarantined");
    if (this.mode === "git-sync") {
      const remote2 = await this.slot("check", "remote");
      if (remote2 === void 0 || !same5(remote2, before))
        return result("ambiguous");
    }
    const decision = decideControllerSlot(
      this.prefix,
      this.scope,
      this.holder,
      authority?.knownHolder,
      before,
      authority?.continuation,
      authority?.release
    );
    if (decision.kind === "blocked") return result("blocked");
    if (decision.kind === "quarantined") return result("quarantined");
    if (decision.kind === "resume" || decision.kind === "continue")
      return this.confirmDurableSlot(before);
    return makeSlotTransitionIntent(
      "acquire",
      this.holder,
      this.scope,
      {
        head: state.head,
        ...state.remoteHead === void 0 ? {} : { remoteHead: state.remoteHead },
        slot: before
      },
      this.expectedSlot("acquire", before)
    );
  }
  /** Releases only after a positive available readback from the built-in slot. */
  async release(authority) {
    if (!this.usable || authority === void 0 || !this.validReleaseAuthority(authority))
      return result("quarantined");
    const initial = await this.state();
    if (initial === void 0 || !initial.reachable)
      return result("unavailable");
    if (initial.workingSet === "unknown") return result("ambiguous");
    if (initial.workingSet !== "clean" || this.mode === "git-sync" && initial.head !== initial.remoteHead)
      return this.recoverSlotTransition("release", authority?.transition);
    const before = await this.slot("check");
    if (before !== void 0 && same5(before, authority.transition.after))
      return this.reconcileLostSlotTransition(
        "release",
        authority.transition,
        initial,
        before
      );
    if (before === void 0 || before.status !== "acquired" || before.actor !== this.holder || before.holder !== this.holder)
      return result("blocked");
    const state = await this.state();
    if (state === void 0 || !state.reachable || state.workingSet !== "clean" || state.head === void 0 || this.mode === "git-sync" && (state.remoteHead === void 0 || state.remoteHead !== state.head))
      return result("ambiguous");
    const transition = authority.transition;
    if (!this.matchesTransitionBefore(transition, "release", state, before))
      return result("quarantined");
    const released = await this.slot("release");
    if (released === void 0) return result("quarantined");
    if (!same5(released, transition.after)) return result("blocked");
    return this.durableSlotTransition(transition);
  }
  /** Read-only planning half of release; see `prepareAcquireTransition`. */
  async prepareReleaseTransition() {
    if (!this.usable) return result("quarantined");
    const state = await this.state();
    if (state === void 0 || !state.reachable) return result("unavailable");
    if (state.workingSet !== "clean" || state.head === void 0 || this.mode === "git-sync" && (state.remoteHead === void 0 || state.remoteHead !== state.head))
      return result("ambiguous");
    const before = await this.slot("check");
    if (before === void 0 || before.status !== "acquired" || before.actor !== this.holder || before.holder !== this.holder)
      return result("blocked");
    if (this.mode === "git-sync") {
      const remote2 = await this.slot("check", "remote");
      if (remote2 === void 0 || !same5(remote2, before))
        return result("ambiguous");
    }
    return makeSlotTransitionIntent(
      "release",
      this.holder,
      this.scope,
      {
        head: state.head,
        ...state.remoteHead === void 0 ? {} : { remoteHead: state.remoteHead },
        slot: before
      },
      this.expectedSlot("release", before)
    );
  }
  /** Generic read-only planning port used by production CLI composition. */
  async prepareControllerTransition(input) {
    if (input.holder !== this.holder || !same5(input.scope, this.scope))
      return { status: "quarantined" };
    const planned = input.kind === "acquire" ? await this.prepareAcquireTransition() : await this.prepareReleaseTransition();
    if (!("code" in planned)) return { status: "planned", transition: planned };
    if (planned.code === "blocked" || planned.code === "holder_mismatch")
      return { status: "blocked" };
    if (planned.code === "unavailable") return { status: "unavailable" };
    return planned.code === "quarantined" ? { status: "quarantined" } : { status: "ambiguous" };
  }
  /**
   * Reconciles an already-journalled slot transition without invoking acquire,
   * release, commit, pull, or push. Positive observation requires both the
   * exact local transition-history proof and current after-slot readback.
   */
  async reconcileControllerTransition(transition) {
    if (!this.usable || !validateSlotTransitionIntent(
      transition,
      this.prefix,
      this.scope,
      this.mode,
      this.holder
    ))
      return { status: "ambiguous" };
    const state = await this.state();
    const current = await this.slot("check");
    if (state === void 0 || current === void 0)
      return { status: "unavailable" };
    if (!state.reachable || state.workingSet !== "clean" || state.head === void 0 || this.mode === "git-sync" && state.remoteHead === void 0)
      return { status: "ambiguous" };
    if (same5(current, transition.after)) {
      const proof = await this.call({
        kind: "slot_transition",
        intent: transition
      });
      if (proof?.kind !== "slot_transition" || proof.value !== "observed")
        return { status: "ambiguous" };
      if (this.mode === "git-sync") {
        const remote2 = await this.slot("check", "remote");
        if (remote2 === void 0 || !same5(remote2, transition.after))
          return { status: "ambiguous" };
      }
      return { status: "observed" };
    }
    if (current.status === "acquired" && current.holder !== this.holder)
      return { status: "blocked" };
    if (same5(current, transition.before.slot) && state.head === transition.before.head && (this.mode === "local-only" || state.remoteHead === transition.before.remoteHead))
      return { status: "absent" };
    return { status: "ambiguous" };
  }
  /** Execute only a validated transition recovered from the durable journal. */
  async executeControllerTransition(transition) {
    if (!this.usable || !validateSlotTransitionIntent(
      transition,
      this.prefix,
      this.scope,
      this.mode,
      this.holder
    ))
      return { status: "ambiguous" };
    const outcome = transition.kind === "acquire" ? await this.acquire({ transition }) : await this.release({ transition });
    if (outcome.code === "applied") return { status: "observed" };
    if (outcome.code === "blocked" || outcome.code === "holder_mismatch")
      return { status: "blocked" };
    return outcome.code === "unavailable" ? { status: "unavailable" } : { status: "ambiguous" };
  }
  /** One validated aggregate/child mutation batch, followed by exact readback. */
  async compareAndSet(batch) {
    if (!this.usable || !validateMutationBatch(batch).ok || !same5(batch.scope, this.scope) || batch.holder !== this.holder)
      return { status: "quarantined" };
    const recovery = await this.state();
    if (recovery === void 0 || !recovery.reachable)
      return { status: "unavailable" };
    if (recovery.workingSet === "pending") {
      const discovered2 = await this.discover("before_commit", batch);
      if (discovered2.status !== "observed") return { status: "ambiguous" };
      const baseline2 = this.checkpointBaseline(recovery);
      if (baseline2 === void 0 || !this.matchesCheckpointBaseline(discovered2, baseline2))
        return { status: "ambiguous" };
      const slot2 = await this.slot("check");
      if (slot2 === void 0 || slot2.status !== "acquired" || slot2.actor !== this.holder || slot2.holder !== this.holder)
        return { status: "holder_mismatch" };
      const durable2 = await this.durableCheckpoint(batch, baseline2);
      if (durable2.code !== "applied") return this.storeFailure(durable2.code);
      const readback2 = await this.readback(batch);
      return readback2 === void 0 || !same5(readback2.root, batch.next.root) || !same5(readback2.children, batch.next.children) ? { status: "quarantined" } : {
        affectedRowCount: 1 + batch.changedRows.length,
        checkpoint: batch.checkpoint,
        children: [...readback2.children],
        root: readback2.root,
        status: "applied"
      };
    }
    if (recovery.workingSet !== "clean") return { status: "ambiguous" };
    if (this.mode === "git-sync" && recovery.head !== void 0 && recovery.remoteHead !== void 0 && recovery.head !== recovery.remoteHead) {
      const discovered2 = await this.discover("before_push", batch);
      if (discovered2.status === "observed" && discovered2.head === recovery.head && discovered2.baseHead !== void 0 && discovered2.remoteHead === recovery.remoteHead) {
        const slot2 = await this.slot("check");
        if (slot2 === void 0 || slot2.status !== "acquired" || slot2.actor !== this.holder || slot2.holder !== this.holder)
          return { status: "holder_mismatch" };
        const durable2 = await this.durableCheckpoint(batch, {
          head: discovered2.baseHead,
          remoteHead: discovered2.remoteHead
        });
        if (durable2.code !== "applied") return this.storeFailure(durable2.code);
        const readback2 = await this.readback(batch);
        return readback2 === void 0 || !same5(readback2.root, batch.next.root) || !same5(readback2.children, batch.next.children) ? { status: "quarantined" } : {
          affectedRowCount: 1 + batch.changedRows.length,
          checkpoint: batch.checkpoint,
          children: [...readback2.children],
          root: readback2.root,
          status: "applied"
        };
      }
    }
    const prepared = await this.prepareSharedState();
    if (prepared.result.code !== "applied")
      return this.storeFailure(prepared.result.code);
    const slot = await this.slot("check");
    if (slot === void 0 || slot.status !== "acquired" || slot.actor !== this.holder || slot.holder !== this.holder)
      return { status: "holder_mismatch" };
    const baseline = this.checkpointBaseline(prepared.state);
    if (baseline === void 0) return { status: "ambiguous" };
    const mutation = await this.call({ kind: "mutation", batch });
    if (mutation?.kind !== "mutation") return { status: "ambiguous" };
    if (mutation.value !== "applied") {
      if (mutation.value !== "stale") return { status: mutation.value };
      const discovered2 = await this.discover(
        this.mode === "git-sync" ? "after_push" : "after_commit",
        batch
      );
      if (discovered2.status !== "observed" || discovered2.head !== baseline.head || this.mode === "git-sync" && discovered2.remoteHead !== baseline.remoteHead)
        return {
          status: discovered2.status === "absent" ? "stale" : "ambiguous"
        };
      const readback2 = await this.readback(batch);
      return readback2 === void 0 || !same5(readback2.root, batch.next.root) || !same5(readback2.children, batch.next.children) ? { status: "quarantined" } : {
        affectedRowCount: 1 + batch.changedRows.length,
        checkpoint: batch.checkpoint,
        children: [...readback2.children],
        root: readback2.root,
        status: "applied"
      };
    }
    const durable = await this.durableCheckpoint(batch, baseline);
    if (durable.code !== "applied") return this.storeFailure(durable.code);
    const readback = await this.readback(batch);
    if (readback === void 0 || !same5(readback.root, batch.next.root) || !same5(readback.children, batch.next.children))
      return { status: "quarantined" };
    return {
      affectedRowCount: 1 + batch.changedRows.length,
      checkpoint: batch.checkpoint,
      children: [...readback.children],
      root: readback.root,
      status: "applied"
    };
  }
  /**
   * Authoritative projection load. Only the process's positive `absent` is
   * passed through; malformed, partial, and transport failures remain tagged
   * failures and can never drive bootstrap.
   */
  async load() {
    if (!this.usable) return { status: "quarantined" };
    const response = await this.call({ kind: "load" });
    if (response?.kind !== "load") return { status: "unavailable" };
    if (response.value.status !== "observed") return response.value;
    const root = validateRootProjection(response.value.value.root);
    if (!root.ok || !same5(root.value.scope, this.scope))
      return { status: "corrupt" };
    const expected = root.value.childRows;
    const children = response.value.value.children;
    if (children.length !== expected.length) return { status: "corrupt" };
    const seen = /* @__PURE__ */ new Set();
    for (const child of children) {
      const parsed = validateChildProjection(child);
      const reference = parsed.ok ? expected.find((row) => row.unitId === parsed.value.unitId) : void 0;
      if (!parsed.ok || reference === void 0 || seen.has(parsed.value.unitId) || parsed.value.revision !== reference.revision || parsed.value.commitment !== reference.commitment || !same5(parsed.value.scope, root.value.scope) || parsed.value.holder !== root.value.holder)
        return { status: "corrupt" };
      seen.add(parsed.value.unitId);
    }
    return seen.size !== expected.length ? { status: "corrupt" } : { status: "observed", value: response.value.value };
  }
  /**
   * The sole existing-root write permitted before controller ownership. It is
   * intentionally narrower than compareAndSet: it writes only a validated
   * unacquired -> acquire_intent journal transition, never an active run.
   */
  async persistControllerAcquireIntent(batch) {
    if (!this.validPreOwnershipBatch(batch)) return { status: "quarantined" };
    const loaded = await this.load();
    if (loaded.status !== "observed") return this.loadFailure(loaded.status);
    const current = loaded.value.root;
    if (this.isExactIntentReadback(loaded.value, batch))
      return this.durablePreOwnershipIntent(batch);
    if (current.aggregateRevision !== batch.expectedAggregateRevision || current.aggregateCommitment !== batch.expectedAggregateCommitment || current.holder !== batch.expectedHolder || !this.isPreOwnershipTransition(current, batch.next.root))
      return { status: "stale" };
    const slot = await this.availablePreOwnershipSlot();
    if (slot === void 0) return { status: "ambiguous" };
    const state = await this.state();
    if (state === void 0 || !state.reachable || state.workingSet !== "clean" || this.mode === "git-sync" && (state.head === void 0 || state.remoteHead !== state.head))
      return { status: "ambiguous" };
    const mutation = await this.call({
      kind: "preownership_mutation",
      batch,
      slot
    });
    if (mutation?.kind !== "mutation") return { status: "unavailable" };
    if (mutation.value === "applied")
      return this.durablePreOwnershipIntent(batch);
    if (mutation.value !== "stale") return { status: mutation.value };
    const after = await this.load();
    if (after.status !== "observed") return this.loadFailure(after.status);
    return this.isExactIntentReadback(after.value, batch) ? this.durablePreOwnershipIntent(batch) : { status: "stale" };
  }
  /** Atomic absent-root bootstrap; active runs and ordinary CAS are refused. */
  async createControllerAcquireIntent(request) {
    const parsed = validate(
      InitialControllerAcquireSchema,
      request
    );
    if (!this.usable || !parsed.ok || parsed.value === void 0 || !same5(parsed.value.expected.scope, this.scope) || parsed.value.expected.holder !== this.holder)
      return { status: "quarantined" };
    const projection = parsed.value.next;
    if (!this.validInitialProjection(projection))
      return { status: "quarantined" };
    const existing = await this.load();
    if (existing.status === "observed")
      return this.isExactInitialReadback(existing.value, projection) ? this.durableInitialIntent(projection) : { status: "stale" };
    if (existing.status !== "absent") return this.loadFailure(existing.status);
    const slot = await this.availablePreOwnershipSlot();
    if (slot === void 0) return { status: "ambiguous" };
    const state = await this.state();
    if (state === void 0 || !state.reachable || state.workingSet !== "clean" || this.mode === "git-sync" && (state.head === void 0 || state.remoteHead !== state.head))
      return { status: "ambiguous" };
    const initialized = await this.call({
      kind: "initialize",
      input: projection,
      slot
    });
    if (initialized?.kind !== "mutation") return { status: "unavailable" };
    if (initialized.value === "applied")
      return this.durableInitialIntent(projection);
    if (initialized.value !== "stale") return { status: initialized.value };
    const after = await this.load();
    if (after.status !== "observed") return this.loadFailure(after.status);
    return this.isExactInitialReadback(after.value, projection) ? this.durableInitialIntent(projection) : { status: "stale" };
  }
  validInitialProjection(input) {
    const root = validateRootProjection(input.root);
    if (!root.ok || !same5(root.value.scope, this.scope)) return false;
    if (root.value.aggregateRevision !== 1) return false;
    const values = [];
    for (const inputChild of input.children) {
      const child = validateChildProjection(inputChild);
      if (!child.ok) return false;
      values.push(child.value);
    }
    values.sort(
      (a, b) => a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0
    );
    if (!same5(values, input.children) || values.length !== root.value.childRows.length || values.some(
      (child, index) => root.value.childRows[index]?.unitId !== child.unitId || root.value.childRows[index]?.revision !== child.revision || root.value.childRows[index]?.commitment !== child.commitment
    ))
      return false;
    return root.value.run.revision === 1 && root.value.run.effectJournal.length === 1 && this.isPreOwnershipTransition(void 0, root.value);
  }
  validPreOwnershipBatch(batch) {
    return this.usable && validateMutationBatch(batch).ok && same5(batch.scope, this.scope) && batch.holder === this.holder && this.isPreOwnershipTransition(void 0, batch.next.root);
  }
  isPreOwnershipTransition(before, next) {
    const prior = before?.run;
    const run2 = next.run;
    const entry = run2.effectJournal.at(-1);
    return next.holder === this.holder && same5(next.scope, this.scope) && run2.state === "initializing" && run2.controller.holder === this.holder && run2.controller.state === "acquire_intent" && run2.effectJournal.length === (prior?.effectJournal.length ?? 0) + 1 && entry?.kind === "controller_acquire" && entry.status === "intended" && entry.slotTransition !== void 0 && validateSlotTransitionIntent(
      entry.slotTransition,
      this.prefix,
      this.scope,
      this.mode,
      this.holder
    ) && (prior === void 0 || prior.state === "initializing" && prior.controller.holder === this.holder && prior.controller.state === "unacquired" && prior.effectJournal.length === 0 && run2.effectJournal.length === prior.effectJournal.length + 1);
  }
  isExactIntentReadback(readback, batch) {
    if (!same5(readback.root, batch.next.root)) return false;
    return batch.next.children.every(
      (expected) => readback.children.some((actual) => same5(actual, expected))
    );
  }
  isExactInitialReadback(readback, input) {
    return same5(readback.root, input.root) && same5(readback.children, input.children);
  }
  async availablePreOwnershipSlot() {
    const prepared = await this.prepareSharedState();
    if (prepared.result.code !== "applied") return void 0;
    const local = await this.slot("check");
    if (local === void 0 || local.status !== "available" || local.holder !== void 0)
      return void 0;
    if (this.mode === "local-only") return local;
    const remote2 = await this.slot("check", "remote");
    return remote2 !== void 0 && same5(remote2, local) ? local : void 0;
  }
  async durablePreOwnershipIntent(batch) {
    const durable = await this.durableCheckpoint(batch);
    if (durable.code !== "applied") return this.storeFailure(durable.code);
    const readback = await this.readback(batch);
    return readback === void 0 || !this.isExactIntentReadback(readback, batch) ? { status: "quarantined" } : {
      affectedRowCount: 1 + batch.changedRows.length,
      checkpoint: batch.checkpoint,
      children: [...batch.next.children],
      root: batch.next.root,
      status: "applied"
    };
  }
  /** Commit/push and exact load after the separate absent-row SQL mutation. */
  async durableInitialIntent(input) {
    let state = await this.state();
    if (state === void 0 || !state.reachable || state.workingSet === "unknown")
      return { status: "unavailable" };
    if (state.workingSet === "pending" || state.workingSet === "clean") {
      const committed = await this.call({ kind: "initial_commit", input });
      if (committed?.kind !== "commit" || committed.value !== "applied")
        return {
          status: committed?.kind === "commit" && committed.value === "unavailable" ? "unavailable" : "ambiguous"
        };
      state = await this.state();
    }
    if (state === void 0 || !state.reachable || state.workingSet !== "clean" || state.head === void 0)
      return { status: "ambiguous" };
    if (this.mode === "git-sync") {
      if (state.remoteHead === state.head) {
      } else {
        const pushed = await this.call({ kind: "initial_push", input });
        if (pushed?.kind !== "push" || pushed.value !== "applied")
          return {
            status: pushed?.kind === "push" && pushed.value === "unavailable" ? "unavailable" : "ambiguous"
          };
        state = await this.state();
        if (state === void 0 || !state.reachable || state.workingSet !== "clean" || state.head === void 0 || state.remoteHead !== state.head)
          return { status: "ambiguous" };
      }
    }
    const loaded = await this.load();
    if (loaded.status !== "observed") return this.loadFailure(loaded.status);
    return !this.isExactInitialReadback(loaded.value, input) ? { status: "stale" } : {
      affectedRowCount: 1 + input.children.length,
      checkpoint: input.root.checkpoint,
      children: [...input.children],
      root: input.root,
      status: "applied"
    };
  }
  loadFailure(status) {
    switch (status) {
      case "absent":
        return { status: "stale" };
      case "corrupt":
        return { status: "quarantined" };
      default:
        return { status };
    }
  }
  /** Records a clean baseline before a cooperative worker/reviewer session. */
  async workerBaseline() {
    if (!this.usable) return void 0;
    const state = await this.state();
    if (state === void 0 || state.workingSet !== "clean" || this.mode === "git-sync" && (state.head === void 0 || state.remoteHead === void 0 || state.head !== state.remoteHead))
      return void 0;
    const slot = await this.slot("check");
    if (slot === void 0 || slot.status !== "acquired" || slot.actor !== this.holder || slot.holder !== this.holder)
      return void 0;
    return {
      ...state.head === void 0 ? {} : { head: state.head },
      ...this.mode === "git-sync" ? { remoteHead: state.remoteHead } : {},
      slot,
      workingSet: "clean"
    };
  }
  /** Detects tracker mutation by a worker; it intentionally does not repair it. */
  async verifyWorkerBaseline(baseline) {
    if (!this.usable) return result("quarantined");
    if (!this.validWorkerBaseline(baseline)) return result("quarantined");
    const state = await this.state();
    const slot = await this.slot("check");
    if (state === void 0 || slot === void 0) return result("ambiguous");
    return state.workingSet === "clean" && state.head === baseline.head && state.remoteHead === baseline.remoteHead && slot.status === "acquired" && slot.actor === this.holder && slot.holder === this.holder && same5(slot, baseline.slot) ? result("applied") : result("worker_mutation");
  }
  async prepareSharedState() {
    const before = await this.state();
    if (before === void 0 || !before.reachable)
      return { result: result("unavailable") };
    if (before.workingSet !== "clean") return { result: result("blocked") };
    if (this.mode === "local-only")
      return { result: result("applied"), state: before };
    const pull = await this.call({ kind: "pull" });
    if (pull?.kind !== "pull") return { result: result("ambiguous") };
    if (pull.value === "conflict") return { result: result("conflict") };
    if (pull.value !== "applied") return { result: result(pull.value) };
    const after = await this.state();
    return after === void 0 || !after.reachable ? { result: result("unavailable") } : after.workingSet === "clean" ? { result: result("applied"), state: after } : { result: result("blocked") };
  }
  expectedSlot(kind, before) {
    const value = {
      ...before,
      actor: this.holder,
      ...kind === "acquire" ? { holder: this.holder } : {},
      ...kind === "acquire" ? { status: "acquired" } : { status: "available" }
    };
    if (kind === "release") delete value.holder;
    const { readbackHash: _ignored, ...withoutHash } = value;
    return {
      ...withoutHash,
      readbackHash: deriveSlotReadbackHash(withoutHash)
    };
  }
  matchesTransitionBefore(transition, kind, state, slot) {
    return validateSlotTransitionIntent(
      transition,
      this.prefix,
      this.scope,
      this.mode,
      this.holder
    ) && transition.kind === kind && state.head !== void 0 && transition.before.head === state.head && transition.before.remoteHead === state.remoteHead && same5(transition.before.slot, slot) && same5(transition.after, this.expectedSlot(kind, slot));
  }
  /**
   * Resumes only a controller-journalled built-in transition. The process
   * proves the entire local delta before this method can commit or push it.
   */
  async recoverSlotTransition(kind, transition) {
    if (transition === void 0 || !validateSlotTransitionIntent(
      transition,
      this.prefix,
      this.scope,
      this.mode,
      this.holder
    ) || transition.kind !== kind)
      return result("ambiguous");
    const state = await this.state();
    const local = await this.slot("check");
    if (state === void 0 || !state.reachable || state.workingSet === "unknown" || local === void 0 || !same5(local, transition.after) || state.head === void 0 || // A pending change retains the before head; an auto-committed change
    // must have created a new head. Either other shape is unrelated state.
    state.workingSet === "pending" && state.head !== transition.before.head || state.workingSet === "clean" && state.head === transition.before.head)
      return result("ambiguous");
    if (this.mode === "git-sync") {
      if (state.remoteHead === transition.before.remoteHead) {
        const remote2 = await this.slot("check", "remote");
        if (remote2 === void 0 || !same5(remote2, transition.before.slot))
          return result("ambiguous");
      } else if (state.workingSet === "clean") {
        return this.reconcileRemoteSlotTransition(
          kind,
          transition,
          state,
          local
        );
      } else return result("ambiguous");
    }
    return this.durableSlotTransition(transition);
  }
  /** Runtime-checks the semantic cross-clone proof returned by the process. */
  remoteTransitionProofMatches(value, state) {
    const proof = object4(value);
    return proof !== void 0 && Object.keys(proof).length === 6 && proof.schema === "sce.beads-embedded.remote-slot-transition-proof" && proof.status === "observed" && proof.version === 1 && head2(proof.effectHead) && head2(proof.localHead) && head2(proof.remoteHead) && proof.effectHead === proof.remoteHead && proof.localHead === state.head && proof.remoteHead === state.remoteHead;
  }
  /**
   * Replays an already-pushed transition from another clone only after its
   * remote parent→effect proof and this clone's pinned merge proof agree.
   */
  async reconcileRemoteSlotTransition(kind, transition, state, local) {
    if (!validateSlotTransitionIntent(
      transition,
      this.prefix,
      this.scope,
      "git-sync",
      this.holder
    ) || transition.kind !== kind || !state.reachable || state.workingSet !== "clean" || state.head === void 0 || state.remoteHead === void 0 || state.head === transition.before.head || state.remoteHead === transition.before.remoteHead || !same5(local, transition.after))
      return result("ambiguous");
    const proof = await this.call({
      kind: "remote_slot_transition",
      intent: transition
    });
    if (proof?.kind !== "remote_slot_transition" || !this.remoteTransitionProofMatches(proof.value, state))
      return result("ambiguous");
    const remote2 = await this.slot("check", "remote");
    const final = await this.state();
    return remote2 !== void 0 && same5(remote2, transition.after) && final !== void 0 && final.reachable && final.workingSet === "clean" && final.head === state.head && final.remoteHead === state.remoteHead ? result("applied") : result("ambiguous");
  }
  /**
   * Reconciles a clean, already-durable slot transition after its caller lost
   * the result.  Unlike the ordinary current-slot decision, this path must
   * prove the exact persisted transition delta before it can publish applied.
   */
  async reconcileLostSlotTransition(kind, transition, state, local) {
    if (!validateSlotTransitionIntent(
      transition,
      this.prefix,
      this.scope,
      this.mode,
      this.holder
    ) || transition.kind !== kind || !state.reachable || state.workingSet !== "clean" || state.head === void 0 || state.head === transition.before.head || !same5(local, transition.after) || this.mode === "git-sync" && (state.remoteHead === void 0 || state.remoteHead !== state.head))
      return result("ambiguous");
    const prove = await this.call({
      kind: "slot_transition",
      intent: transition
    });
    if (prove?.kind !== "slot_transition" || prove.value !== "observed")
      return result("ambiguous");
    if (this.mode === "local-only") {
      const final2 = await this.state();
      return final2 !== void 0 && final2.reachable && final2.workingSet === "clean" && final2.head === state.head ? result("applied") : result("ambiguous");
    }
    const remote2 = await this.slot("check", "remote");
    const final = await this.state();
    return remote2 !== void 0 && same5(remote2, transition.after) && final !== void 0 && final.reachable && final.workingSet === "clean" && final.head === state.head && final.remoteHead === state.head ? result("applied") : result("ambiguous");
  }
  /**
   * Applies a transition only after a semantic process proof that its delta
   * contains the built-in slot issue and its unavoidable audit event, with no
   * other table, issue, or label movement.
   */
  async durableSlotTransition(transition) {
    const prove = await this.call({
      kind: "slot_transition",
      intent: transition
    });
    if (prove?.kind !== "slot_transition" || prove.value !== "observed")
      return result("ambiguous");
    let state = await this.state();
    if (state === void 0 || !state.reachable || state.workingSet === "unknown")
      return result("ambiguous");
    if (state.workingSet === "pending") {
      const commit2 = await this.call({ kind: "commit" });
      if (commit2?.kind !== "commit" || commit2.value !== "applied")
        return result(
          commit2?.kind === "commit" && commit2.value === "unavailable" ? "unavailable" : "ambiguous"
        );
      const afterCommit = await this.call({
        kind: "slot_transition",
        intent: transition
      });
      if (afterCommit?.kind !== "slot_transition" || afterCommit.value !== "observed")
        return result("ambiguous");
      state = await this.state();
    }
    if (state === void 0 || !state.reachable || state.workingSet !== "clean" || state.head === void 0)
      return result("ambiguous");
    const local = await this.slot("check");
    if (local === void 0 || !same5(local, transition.after))
      return result("ambiguous");
    if (this.mode === "local-only") return result("applied");
    if (state.remoteHead !== transition.before.remoteHead || state.head === transition.before.remoteHead)
      return result("ambiguous");
    const remoteBefore = await this.slot("check", "remote");
    if (remoteBefore === void 0 || !same5(remoteBefore, transition.before.slot))
      return result("ambiguous");
    const push = await this.call({ kind: "push" });
    if (push?.kind !== "push") return result("ambiguous");
    if (push.value === "conflict") return result("conflict");
    if (push.value !== "applied") return result("ambiguous");
    const synced = await this.state();
    const remoteAfter = await this.slot("check", "remote");
    const final = await this.state();
    return synced !== void 0 && synced.reachable && synced.workingSet === "clean" && synced.head !== void 0 && synced.remoteHead === synced.head && same5(synced.head, state.head) && remoteAfter !== void 0 && same5(remoteAfter, transition.after) && final !== void 0 && final.reachable && final.workingSet === "clean" && final.head === state.head && final.remoteHead === state.head ? result("applied") : result("ambiguous");
  }
  async confirmDurableSlot(local) {
    if (this.mode === "local-only") return result("applied");
    const state = await this.state();
    const remote2 = await this.slot("check", "remote");
    const final = await this.state();
    return state !== void 0 && state.reachable && state.workingSet === "clean" && state.head !== void 0 && state.remoteHead === state.head && remote2 !== void 0 && same5(remote2, local) && final !== void 0 && final.reachable && final.workingSet === "clean" && final.head === state.head && final.remoteHead === state.head ? result("applied") : result("ambiguous");
  }
  /** Commit state and sync it without force; discovery brackets commit/push. */
  async durableCheckpoint(batch, baseline) {
    const initial = await this.state();
    if (initial === void 0 || !initial.reachable)
      return result("unavailable");
    if (initial.workingSet === "unknown") return result("ambiguous");
    let committedHead;
    if (initial.workingSet === "pending") {
      const beforeCommit = batch === void 0 ? void 0 : await this.discover("before_commit", batch);
      if (beforeCommit !== void 0 && (beforeCommit.status !== "observed" || baseline !== void 0 && !this.matchesCheckpointBaseline(beforeCommit, baseline)))
        return result(
          beforeCommit.status === "ambiguous" ? "ambiguous" : "blocked"
        );
      const commit2 = await this.call({ kind: "commit" });
      if (commit2?.kind !== "commit") return result("ambiguous");
      if (commit2.value !== "applied")
        return result(
          commit2.value === "unavailable" ? "ambiguous" : commit2.value
        );
      const afterCommit = batch === void 0 ? void 0 : await this.discover("after_commit", batch);
      if (afterCommit !== void 0 && (afterCommit.status !== "observed" || afterCommit.head === void 0 || baseline !== void 0 && !this.matchesCheckpointBaseline(afterCommit, baseline)))
        return result("ambiguous");
      committedHead = afterCommit?.head;
    }
    const clean = await this.state();
    if (clean === void 0 || !clean.reachable) return result("unavailable");
    if (clean.workingSet !== "clean" || clean.head === void 0 || committedHead !== void 0 && clean.head !== committedHead)
      return result("blocked");
    if (this.mode === "local-only") return result("applied");
    const beforePush = batch === void 0 ? void 0 : await this.discover("before_push", batch);
    if (beforePush !== void 0 && (beforePush.status !== "observed" || baseline !== void 0 && !this.matchesCheckpointBaseline(beforePush, baseline)))
      return result("ambiguous");
    const push = await this.call({ kind: "push" });
    if (push?.kind !== "push") return result("ambiguous");
    if (push.value === "conflict") return result("conflict");
    if (push.value !== "applied") return result(push.value);
    const afterPush = batch === void 0 ? void 0 : await this.discover("after_push", batch);
    if (afterPush !== void 0 && (afterPush.status !== "observed" || afterPush.head === void 0 || afterPush.remoteHead === void 0))
      return result("ambiguous");
    const synced = await this.state();
    if (batch === void 0)
      return synced !== void 0 && synced.reachable && synced.workingSet === "clean" && synced.head !== void 0 && synced.remoteHead === synced.head ? result("applied") : result("ambiguous");
    return synced !== void 0 && synced.reachable && synced.workingSet === "clean" && synced.head !== void 0 && synced.remoteHead !== void 0 && synced.remoteHead === synced.head && (afterPush === void 0 || afterPush.head === synced.head && afterPush.remoteHead === synced.head) ? result("applied") : result("ambiguous");
  }
  async state() {
    const response = await this.call({ kind: "state" });
    return response?.kind === "state" ? response.value : void 0;
  }
  checkpointBaseline(state) {
    if (state === void 0 || !state.reachable || !head2(state.head))
      return void 0;
    if (this.mode === "local-only") return { head: state.head };
    return head2(state.remoteHead) ? { head: state.head, remoteHead: state.remoteHead } : void 0;
  }
  matchesCheckpointBaseline(discovery, baseline) {
    return discovery.baseHead === baseline.head && (this.mode === "local-only" ? baseline.remoteHead === void 0 : baseline.remoteHead !== void 0 && discovery.remoteHead === baseline.remoteHead);
  }
  validWorkerBaseline(input) {
    const baseline = object4(input);
    if (baseline === void 0 || Object.keys(baseline).some(
      (key) => !["head", "remoteHead", "slot", "workingSet"].includes(key)
    ) || baseline.workingSet !== "clean" || baseline.head !== void 0 && !head2(baseline.head) || baseline.remoteHead !== void 0 && !head2(baseline.remoteHead))
      return false;
    const slot = validateMergeSlotObservation(
      baseline.slot,
      this.prefix,
      this.scope
    );
    if (!slot.ok || slot.value.status !== "acquired" || slot.value.actor !== this.holder || slot.value.holder !== this.holder)
      return false;
    return this.mode === "git-sync" ? baseline.head !== void 0 && baseline.remoteHead !== void 0 && baseline.head === baseline.remoteHead : baseline.remoteHead === void 0;
  }
  validAcquisitionAuthority(authority) {
    if (authority === void 0) return true;
    const input = object4(authority);
    if (input === void 0 || Object.keys(input).some(
      (key) => key !== "knownHolder" && key !== "continuation" && key !== "release" && key !== "transition"
    ) || input.knownHolder !== void 0 && !holder3(input.knownHolder))
      return false;
    if (input.release !== void 0) {
      const release = object4(input.release);
      if (release === void 0 || Object.keys(release).some(
        (key) => key !== "holder" && key !== "readback"
      ) || input.knownHolder === void 0 || release.holder !== input.knownHolder || !validateMergeSlotObservation(release.readback, this.prefix, this.scope).ok || release.readback === void 0)
        return false;
    }
    if (input.transition !== void 0 && !validateSlotTransitionIntent(
      input.transition,
      this.prefix,
      this.scope,
      this.mode,
      this.holder
    ))
      return false;
    if (input.continuation === void 0) return true;
    const continuation = object4(input.continuation);
    if (continuation === void 0 || Object.keys(continuation).some(
      (key) => key !== "after" && key !== "before" && key !== "nextHolder" && key !== "previousHolder"
    ) || !holder3(continuation.nextHolder) || !holder3(continuation.previousHolder) || input.knownHolder !== continuation.previousHolder)
      return false;
    const before = validateMergeSlotObservation(
      continuation.before,
      this.prefix,
      this.scope
    );
    const after = validateMergeSlotObservation(
      continuation.after,
      this.prefix,
      this.scope
    );
    return before.ok && after.ok && before.value.status === "acquired" && before.value.holder === continuation.previousHolder && before.value.actor === continuation.previousHolder && after.value.status === "acquired" && after.value.holder === continuation.nextHolder && after.value.actor === continuation.nextHolder;
  }
  validAcquisitionPlanningAuthority(authority) {
    if (authority === void 0) return true;
    const input = object4(authority);
    if (input === void 0 || Object.keys(input).some(
      (key) => key !== "knownHolder" && key !== "continuation" && key !== "release"
    ))
      return false;
    return this.validAcquisitionAuthority(input);
  }
  validReleaseAuthority(authority) {
    if (authority === void 0) return true;
    const input = object4(authority);
    return input !== void 0 && Object.keys(input).length === 1 && Object.keys(input)[0] === "transition" && input.transition !== void 0 && validateSlotTransitionIntent(
      input.transition,
      this.prefix,
      this.scope,
      this.mode,
      this.holder
    );
  }
  async slot(action, source) {
    const response = await this.call({
      kind: "slot",
      action,
      actor: this.holder,
      ...source === void 0 ? {} : { source }
    });
    if (response?.kind !== "slot") return void 0;
    const validated = validateMergeSlotObservation(
      response.value,
      this.prefix,
      this.scope
    );
    return validated.ok ? validated.value : void 0;
  }
  async readback(batch) {
    const response = await this.call({ kind: "readback", batch });
    return response?.kind === "readback" ? response.value : void 0;
  }
  async discover(point, batch) {
    const response = await this.call({
      kind: "discover",
      point,
      batch
    });
    return response?.kind === "discover" ? response.value : { status: "ambiguous" };
  }
  async call(request) {
    try {
      return await this.process.execute(request);
    } catch {
      return void 0;
    }
  }
  storeFailure(code) {
    switch (code) {
      case "stale":
      case "holder_mismatch":
      case "ambiguous":
      case "unavailable":
      case "quarantined":
        return { status: code };
      default:
        return { status: "ambiguous" };
    }
  }
};

// src/adapters/beads-server/index.ts
import { spawn as spawn4 } from "node:child_process";
import { createHash as createHash4 } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import { dirname as dirname4, isAbsolute as isAbsolute5, join as join3 } from "node:path";
var MAX_ENDPOINT_BYTES = 320;
var MAX_SCHEMA_BYTES = 160;
var MAX_FINGERPRINT_BYTES = 160;
var bytes = new TextEncoder();
var DOLT_SQL_TIMEOUT_MS = 15e3;
var DOLT_SQL_MAX_STATEMENT_BYTES = 1048576;
var DOLT_SQL_MAX_OUTPUT_BYTES = 1048576;
var DOLT_SQL_MAX_ERROR_BYTES = 4096;
var MUTATION_BATCH_MAX_BYTES = 256 * 1024;
var BD_PROCESS_TIMEOUT_MS = 15e3;
var BD_PROCESS_MAX_OUTPUT_BYTES = 16384;
var PROCESS_TERM_GRACE_MS = 250;
var EXECUTABLE_SAMPLE_BYTES3 = 4096;
var doltSqlTransportOperations = /* @__PURE__ */ new WeakMap();
function executeDoltSqlRead(transport, query) {
  return doltSqlTransportOperations.get(transport)?.executeRead(query) ?? Promise.resolve({ status: "refused" });
}
function doltSqlTransportBinding(transport) {
  return doltSqlTransportOperations.get(transport)?.binding();
}
function executeDoltSqlProgram(transport, query) {
  return doltSqlTransportOperations.get(transport)?.executeProgram(query) ?? Promise.resolve({ status: "refused" });
}
function executeDoltSqlTransaction(transport, statement, expectedRows) {
  return doltSqlTransportOperations.get(transport)?.executeTransaction(statement, expectedRows) ?? Promise.resolve({ status: "refused" });
}
function probeDoltSqlWorkerWrite(transport) {
  return doltSqlTransportOperations.get(transport)?.probeWorkerWrite() ?? Promise.resolve("refused");
}
async function executableSnapshot(executable) {
  try {
    const canonical2 = await realpath(executable);
    const information = await stat(canonical2);
    if (!information.isFile() || (information.mode & 73) === 0)
      return void 0;
    const sampleSize = Math.min(information.size, EXECUTABLE_SAMPLE_BYTES3);
    const handle = await open(canonical2, "r");
    try {
      const first = Buffer.alloc(sampleSize);
      const firstRead = await handle.read(first, 0, sampleSize, 0);
      const lastOffset = Math.max(0, information.size - sampleSize);
      const last = Buffer.alloc(sampleSize);
      const lastRead = await handle.read(last, 0, sampleSize, lastOffset);
      const digest = createHash4("sha256").update("first\0").update(first.subarray(0, firstRead.bytesRead)).update("last\0").update(last.subarray(0, lastRead.bytesRead)).digest("hex");
      return {
        canonical: canonical2,
        fingerprint: [
          canonical2,
          information.dev,
          information.ino,
          information.size,
          information.mtimeMs,
          information.ctimeMs,
          information.mode,
          digest
        ].join(":")
      };
    } finally {
      await handle.close();
    }
  } catch {
    return void 0;
  }
}
var doltSqlTransactionTestHook;
var doltBeadsServerDriverPostTransactionTestHook;
function parseDoltRows(output) {
  const decoded = JSON.parse(output);
  const parsed = Array.isArray(decoded) ? decoded : decoded !== null && typeof decoded === "object" && !Array.isArray(decoded) && Object.keys(decoded).length === 0 ? [] : decoded !== null && typeof decoded === "object" && !Array.isArray(decoded) && Object.keys(decoded).length === 1 && Object.hasOwn(decoded, "rows") && Array.isArray(decoded.rows) ? decoded.rows : void 0;
  if (parsed === void 0 || containsSecretShape(decoded) || !parsed.every(
    (row) => row !== null && typeof row === "object" && !Array.isArray(row)
  ))
    return void 0;
  return parsed;
}
function closedReadSql(query) {
  return /^\s*(?:SELECT|SHOW|DESCRIBE|EXPLAIN)\b/iu.test(query) && !query.includes(";") && !/\b(?:INTO\s+(?:OUTFILE|DUMPFILE)|LOAD_FILE|GET_LOCK|RELEASE_LOCK|SLEEP)\b/iu.test(
    query
  );
}
function loopbackEndpoint(endpoint) {
  const host = endpoint.startsWith("[") ? endpoint.slice(1, endpoint.indexOf("]")) : endpoint.split(":", 1)[0];
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
var DoltSqlTransport = class {
  #identity;
  #executable;
  #password;
  #process;
  #role;
  #credentialReference;
  #user;
  #executablePoisoned = false;
  #executableSnapshot;
  #verifiedExecutable;
  constructor(input) {
    if (!validIdentifier(input.user) || input.executable !== void 0 && !isAbsolute5(input.executable) || input.process === void 0 && input.executable === void 0 || input.identity.transportSecurity === "loopback_plaintext" && !loopbackEndpoint(input.identity.endpoint) || input.identity.topology === "external_server" && input.identity.transportSecurity !== "tls" && input.identity.transportSecurity !== "loopback_plaintext" || input.password !== void 0 && (!safeText(input.password, 4096) || containsSecretShape(input.password)))
      throw new Error("invalid Dolt SQL transport configuration");
    const role = input.role ?? (input.user === "worker" ? "worker" : "writer");
    const credentialReference = input.credentialReference ?? (role === "worker" ? input.identity.workerCredentialReference : input.identity.credentialReference);
    if (role !== "writer" && role !== "worker" || !validIdentifier(credentialReference, MAX_FINGERPRINT_BYTES))
      throw new Error("invalid Dolt SQL transport binding");
    this.#identity = input.identity;
    this.#executable = input.executable;
    this.#password = input.password;
    this.#process = input.process ?? runDoltSql;
    this.#role = role;
    this.#credentialReference = credentialReference;
    this.#user = input.user;
    doltSqlTransportOperations.set(
      this,
      Object.freeze({
        binding: () => ({
          credentialReference: this.#credentialReference,
          identity: this.#identity,
          role: this.#role,
          user: this.#user
        }),
        executeRead: (query) => this.#executeRead(query),
        executeProgram: (query) => this.#executeProgram(query),
        executeTransaction: (statement, expectedRows) => this.#executeTransaction(statement, expectedRows),
        probeWorkerWrite: () => this.#probeWorkerWrite()
      })
    );
  }
  /** Closed internal reads only; callers cannot supply SQL through this class. */
  async #executeRead(query) {
    if (!safeText(query, DOLT_SQL_MAX_STATEMENT_BYTES) || containsSecretShape(query) || !closedReadSql(query))
      return { status: "refused" };
    const result2 = await this.#execute(query);
    if (result2.status !== "ok") return result2;
    try {
      const rows = parseDoltRows(result2.output);
      return rows === void 0 ? { status: "refused" } : { status: "ok", rows };
    } catch {
      return { status: "refused" };
    }
  }
  async #executeProgram(query) {
    if (!safeText(query, DOLT_SQL_MAX_STATEMENT_BYTES))
      return { status: "refused" };
    const result2 = await this.#execute(query);
    if (result2.status !== "ok") return result2;
    try {
      const output = result2.output.trim();
      const results = output.length === 0 ? [] : output.split("\n").filter((line) => line.trim().length > 0).map(parseDoltRows);
      return results.some((rows) => rows === void 0) ? { status: "refused" } : {
        status: "ok",
        results
      };
    } catch {
      return { status: "refused" };
    }
  }
  async #executeTransaction(statement, expectedRows) {
    if (!safeText(statement, DOLT_SQL_MAX_STATEMENT_BYTES) || !Number.isSafeInteger(expectedRows) || expectedRows < 1 || this.#process !== runDoltSql)
      return { status: "refused" };
    const [host, port] = this.#endpointParts();
    const executable = await this.#verifiedDoltExecutable();
    if (host === void 0 || port === void 0 || executable === void 0)
      return { status: "refused" };
    if (await this.#pinnedDoltExecutable() !== executable)
      return { status: "refused" };
    const argv = [
      ...this.#identity.transportSecurity === "loopback_plaintext" ? ["--no-tls"] : [],
      "--host",
      host,
      "--port",
      port,
      "--use-db",
      this.#identity.database,
      "--user",
      this.#user,
      "sql",
      "-r",
      "json"
    ];
    return runDoltSqlTransaction({
      argv,
      executable,
      expectedRows,
      password: this.#password,
      statement
    });
  }
  /**
   * Private, constant no-op capability probe. It never accepts caller SQL and
   * reports denial only for Dolt's exact pinned table-write permission error.
   * Every other failure is deliberately non-evidence.
   */
  async #probeWorkerWrite() {
    const [host, port] = this.#endpointParts();
    const executable = await this.#verifiedDoltExecutable();
    const database = quotedIdentifier(this.#identity.database);
    if (host === void 0 || port === void 0 || executable === void 0 || database === void 0 || await this.#pinnedDoltExecutable() !== executable)
      return "refused";
    const statement = `UPDATE ${database}.issues SET status = status WHERE 1 = 0`;
    try {
      const result2 = await this.#process({
        argv: [
          ...this.#identity.transportSecurity === "loopback_plaintext" ? ["--no-tls"] : [],
          "--host",
          host,
          "--port",
          port,
          "--use-db",
          this.#identity.database,
          "--user",
          this.#user,
          "sql",
          "-q",
          statement,
          "-r",
          "json"
        ],
        executable,
        env: {
          DOLT_CLI_PASSWORD: this.#password ?? "",
          PATH: `${dirname4(executable)}:/usr/bin:/bin`
        },
        timeoutMs: DOLT_SQL_TIMEOUT_MS
      });
      const diagnostic = (result2.stderr ?? "").trim().length > 0 ? result2.stderr ?? "" : result2.output;
      if (result2.timedOut || result2.exitCode === void 0 || Buffer.byteLength(result2.output, "utf8") > DOLT_SQL_MAX_OUTPUT_BYTES || Buffer.byteLength(diagnostic, "utf8") > DOLT_SQL_MAX_ERROR_BYTES || containsSecretShape(diagnostic))
        return "unavailable";
      if (result2.exitCode === 0) return "allowed";
      const escapedStatement = statement.replace(
        /[.*+?^${}()|[\]\\]/gu,
        "\\$&"
      );
      const denied = new RegExp(
        `^error on line 1 for query ${escapedStatement}: Error 1105 \\(HY000\\): command denied to user '${this.#user}'@'%'$`,
        "u"
      );
      return denied.test(diagnostic.trim()) ? "denied" : "unavailable";
    } catch {
      return "unavailable";
    }
  }
  async #execute(query) {
    const [host, port] = this.#endpointParts();
    if (host === void 0 || port === void 0) return { status: "refused" };
    const executable = await this.#verifiedDoltExecutable();
    if (executable === void 0) return { status: "refused" };
    if (await this.#pinnedDoltExecutable() !== executable)
      return { status: "refused" };
    const argv = [
      ...this.#identity.transportSecurity === "loopback_plaintext" ? ["--no-tls"] : [],
      "--host",
      host,
      "--port",
      port,
      "--use-db",
      this.#identity.database,
      "--user",
      this.#user,
      "sql",
      "-q",
      query,
      "-r",
      "json"
    ];
    try {
      const result2 = await this.#process({
        argv,
        executable,
        // Dolt's CLI reads this variable during authentication. Keeping it in
        // the child environment avoids exposing a password through argv.
        env: {
          DOLT_CLI_PASSWORD: this.#password ?? "",
          PATH: this.#executable === void 0 ? process.env.PATH : dirname4(this.#executable)
        },
        timeoutMs: DOLT_SQL_TIMEOUT_MS
      });
      if (result2.timedOut || result2.exitCode !== 0)
        return { status: "unavailable" };
      if (Buffer.byteLength(result2.output, "utf8") > DOLT_SQL_MAX_OUTPUT_BYTES)
        return { status: "unavailable" };
      return { status: "ok", output: result2.output };
    } catch {
      return { status: "unavailable" };
    }
  }
  #endpointParts() {
    const bracketed = /^\[([^\]]+)\]:(\d{1,5})$/u.exec(this.#identity.endpoint);
    if (bracketed !== null) return [bracketed[1], bracketed[2]];
    const plain = /^([A-Za-z0-9.-]+):(\d{1,5})$/u.exec(this.#identity.endpoint);
    return plain === null ? [void 0, void 0] : [plain[1], plain[2]];
  }
  async #verifiedDoltExecutable() {
    if (this.#process !== runDoltSql && this.#executable === void 0)
      return "";
    const executable = await this.#pinnedDoltExecutable();
    if (executable === void 0) return void 0;
    if (this.#verifiedExecutable === executable) return executable;
    const version = await this.#process({
      argv: ["version"],
      executable,
      env: { PATH: `${dirname4(executable)}:/usr/bin:/bin` },
      timeoutMs: DOLT_SQL_TIMEOUT_MS
    });
    if (await this.#pinnedDoltExecutable() !== executable) return void 0;
    if (version.timedOut || version.exitCode !== 0 || Buffer.byteLength(version.output, "utf8") > DOLT_SQL_MAX_OUTPUT_BYTES || !/^dolt version 2\.2\.1(?:\s|$)/u.test(version.output))
      return void 0;
    this.#verifiedExecutable = executable;
    return executable;
  }
  async #pinnedDoltExecutable() {
    if (this.#executablePoisoned) return void 0;
    if (this.#executable === void 0)
      return this.#process === runDoltSql ? void 0 : "";
    const snapshot = await executableSnapshot(this.#executable);
    if (snapshot === void 0)
      return this.#process === runDoltSql ? void 0 : this.#executable;
    if (this.#executableSnapshot !== void 0 && this.#executableSnapshot.fingerprint !== snapshot.fingerprint) {
      this.#executablePoisoned = true;
      return void 0;
    }
    this.#executableSnapshot ??= snapshot;
    return snapshot.canonical;
  }
};
async function runDoltSql(request) {
  return new Promise((resolve5) => {
    const child = spawn4(request.executable, request.argv, {
      env: request.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    let stderr = "";
    let capped = false;
    let failed = false;
    let timedOut = false;
    let closing = false;
    let killTimer;
    const terminate = () => {
      if (closing) return;
      closing = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, PROCESS_TERM_GRACE_MS);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, request.timeoutMs);
    child.stdout.on("data", (chunk) => {
      if (capped) return;
      output += chunk.toString("utf8");
      if (Buffer.byteLength(output, "utf8") > DOLT_SQL_MAX_OUTPUT_BYTES) {
        capped = true;
        terminate();
      }
    });
    child.stderr.on("data", (chunk) => {
      if (capped) return;
      stderr += chunk.toString("utf8");
      if (Buffer.byteLength(stderr, "utf8") > DOLT_SQL_MAX_ERROR_BYTES) {
        capped = true;
        terminate();
      }
    });
    child.once("error", () => {
      failed = true;
      terminate();
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (killTimer !== void 0) clearTimeout(killTimer);
      resolve5({
        exitCode: capped || timedOut || failed ? void 0 : code ?? void 0,
        output,
        stderr,
        timedOut: capped || timedOut
      });
    });
  });
}
async function runDoltSqlTransaction(input) {
  return new Promise((resolve5) => {
    const child = spawn4(input.executable, input.argv, {
      env: {
        DOLT_CLI_PASSWORD: input.password ?? "",
        PATH: `${dirname4(input.executable)}:/usr/bin:/bin`
      },
      stdio: ["pipe", "pipe", "ignore"]
    });
    let output = "";
    let rowCount;
    let result2;
    let finalSent = false;
    let postCommitClean = false;
    let postCommitHead;
    let rowCountPhaseObserved = false;
    let closing = false;
    let stdinClosed = false;
    let outputBytes = 0;
    let killTimer;
    const finishAfterClose = (value) => {
      if (result2 !== void 0) return;
      result2 = value;
    };
    const terminate = (value) => {
      finishAfterClose(value);
      if (closing) return;
      closing = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, PROCESS_TERM_GRACE_MS);
    };
    const observeTestPhase = (phase) => {
      const hook = doltSqlTransactionTestHook;
      if (hook === void 0 || result2 !== void 0) return;
      try {
        hook({
          abort: () => terminate({ status: "unavailable" }),
          pause: () => {
            if (!closing) child.kill("SIGSTOP");
          },
          phase
        });
      } catch {
        terminate({ status: "unavailable" });
      }
    };
    const timer = setTimeout(() => {
      terminate({ status: "unavailable" });
    }, DOLT_SQL_TIMEOUT_MS);
    child.stdin.once("error", () => terminate({ status: "unavailable" }));
    const writeStdin = (value) => {
      if (closing || stdinClosed) return false;
      try {
        child.stdin.write(value, (error) => {
          if (error !== void 0 && error !== null)
            terminate({ status: "unavailable" });
        });
        return true;
      } catch {
        terminate({ status: "unavailable" });
        return false;
      }
    };
    const closeStdin = () => {
      if (stdinClosed) return;
      stdinClosed = true;
      try {
        child.stdin.end(() => void 0);
      } catch {
        terminate({ status: "unavailable" });
      }
    };
    const sendFinal = (commit2) => {
      if (finalSent || closing) return;
      finalSent = true;
      if (!commit2) {
        writeStdin("ROLLBACK;\n");
        closeStdin();
        return;
      }
      if (!writeStdin("COMMIT;\n")) return;
      observeTestPhase("after_commit_before_outcome");
      if (closing) return;
      if (!writeStdin(
        "SELECT DOLT_HASHOF('HEAD') AS committed_head; SELECT COUNT(*) AS working_set_rows FROM dolt_status;\n"
      ))
        return;
      closeStdin();
    };
    const inspectLine = (line) => {
      if (line.trim().length === 0 || result2 !== void 0) return;
      if (!rowCountPhaseObserved && rowCount === void 0 && !finalSent) {
        rowCountPhaseObserved = true;
        observeTestPhase("after_guarded_write_before_rowcount");
        if (closing) return;
      }
      let rows;
      try {
        rows = parseDoltRows(line);
      } catch {
        terminate({ status: "refused" });
        return;
      }
      if (rows === void 0) {
        terminate({ status: "refused" });
        return;
      }
      if (rows.length === 1 && rows[0]?.committed_head !== void 0) {
        const head3 = rows[0].committed_head;
        if (typeof head3 !== "string" || !/^[0-9a-z]{20,64}$/u.test(head3)) {
          terminate({ status: "refused" });
          return;
        }
        postCommitHead = head3;
        return;
      }
      if (rows.length === 1 && rows[0]?.working_set_rows !== void 0) {
        const count = Number(rows[0].working_set_rows);
        if (!Number.isSafeInteger(count) || count !== 0) {
          terminate({ status: "refused" });
          return;
        }
        postCommitClean = true;
        if (postCommitHead === void 0) {
          terminate({ status: "refused" });
          return;
        }
        observeTestPhase("after_commit_marker_before_close");
        return;
      }
      const value = rows[0]?.affected_rows;
      if (value === void 0 || rowCount !== void 0) return;
      const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
      if (!Number.isSafeInteger(parsed) || parsed < 0) {
        terminate({ status: "refused" });
        return;
      }
      rowCount = parsed;
      observeTestPhase("after_rowcount_before_commit");
      if (closing) return;
      sendFinal(parsed === input.expectedRows);
    };
    child.stdout.on("data", (chunk) => {
      if (result2 !== void 0) return;
      outputBytes += Buffer.byteLength(chunk, "utf8");
      if (outputBytes > DOLT_SQL_MAX_OUTPUT_BYTES) {
        terminate({ status: "unavailable" });
        return;
      }
      output += chunk.toString("utf8");
      const lines2 = output.split("\n");
      output = lines2.pop() ?? "";
      for (const line of lines2) inspectLine(line);
    });
    child.once("error", () => terminate({ status: "unavailable" }));
    child.once("close", (code) => {
      clearTimeout(timer);
      if (killTimer !== void 0) clearTimeout(killTimer);
      if (result2 !== void 0) return resolve5(result2);
      if (code !== 0 || !finalSent || rowCount === void 0)
        return resolve5({ status: "unavailable" });
      if (rowCount !== input.expectedRows)
        return resolve5({ status: "ok", rows: rowCount });
      return resolve5(
        postCommitClean && postCommitHead !== void 0 ? { status: "ok", rows: rowCount, committedHead: postCommitHead } : { status: "unavailable" }
      );
    });
    writeStdin(
      `SET @@SESSION.dolt_transaction_commit = 1; START TRANSACTION; ${input.statement}; SET @sce_affected_rows := ROW_COUNT(); SELECT @sce_affected_rows AS affected_rows;
`
    );
  });
}
var PinnedBdServerProcess = class {
  #credentialEnvironment;
  #executable;
  #identity;
  #process;
  #runtimeEnvironment;
  #workspace;
  #executablePoisoned = false;
  #executableSnapshot;
  #verifiedExecutable;
  constructor(input) {
    if (!isAbsolute5(input.executable) || !isAbsolute5(input.workspace))
      throw new Error("invalid pinned bd process configuration");
    this.#credentialEnvironment = input.credentialEnvironment;
    this.#executable = input.executable;
    this.#identity = input.identity;
    this.#process = input.process ?? runPinnedBd;
    this.#runtimeEnvironment = input.runtimeEnvironment;
    this.#workspace = input.workspace;
  }
  async acquire(actor) {
    return this.#run("acquire", actor);
  }
  async check(actor) {
    return this.#run("check", actor);
  }
  async release(actor) {
    return this.#run("release", actor);
  }
  /** Closed domain check used by the driver before every slot mutation. */
  async matchesIdentity(identity2) {
    if (this.#identity === void 0 || !exact(this.#identity, identity2))
      return { status: "refused" };
    const verification = await this.#verify();
    if (verification.status !== "ok") return verification;
    const workspace = await this.#canonicalWorkspace();
    if (workspace === void 0) return { status: "refused" };
    if (await this.#canonicalExecutable() !== verification.executable)
      return { status: "refused" };
    const context = await this.#exec(verification.executable, [
      "-C",
      workspace,
      "context",
      "--json"
    ]);
    if (context.timedOut || context.exitCode !== 0 || Buffer.byteLength(context.output, "utf8") > BD_PROCESS_MAX_OUTPUT_BYTES)
      return { status: "unavailable" };
    if (await this.#canonicalExecutable() !== verification.executable)
      return { status: "refused" };
    let parsed;
    try {
      parsed = JSON.parse(context.output);
    } catch {
      return { status: "refused" };
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) || !this.#matchesContext(
      parsed,
      identity2,
      workspace
    ))
      return { status: "refused" };
    const prefix = await this.#workspacePrefixMatches(
      verification.executable,
      workspace,
      identity2.prefix
    );
    if (prefix === "unavailable") return { status: "unavailable" };
    if (!prefix) return { status: "refused" };
    return { status: "ok" };
  }
  async #run(command, actor) {
    if (!validIdentifier(actor)) return { status: "refused" };
    if (this.#identity !== void 0) {
      const binding = await this.matchesIdentity(this.#identity);
      if (binding.status !== "ok") return binding;
    }
    const verification = await this.#verify();
    if (verification.status !== "ok") return verification;
    const workspace = await this.#canonicalWorkspace();
    if (workspace === void 0) return { status: "refused" };
    const executable = verification.executable;
    if (await this.#canonicalExecutable() !== executable)
      return { status: "refused" };
    const result2 = await this.#exec(executable, [
      "-C",
      workspace,
      "--actor",
      actor,
      "--dolt-auto-commit",
      "on",
      "merge-slot",
      command,
      ...command === "check" ? [] : ["--holder", actor],
      "--json"
    ]);
    if (result2.timedOut || result2.exitCode === void 0 || Buffer.byteLength(result2.output, "utf8") > BD_PROCESS_MAX_OUTPUT_BYTES)
      return { status: "unavailable" };
    if (result2.exitCode !== 0) return { status: "rejected" };
    try {
      const parsed = JSON.parse(result2.output);
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? { status: "completed" } : { status: "ambiguous" };
    } catch {
      return { status: "ambiguous" };
    }
  }
  async #verify() {
    const executable = await this.#canonicalExecutable();
    if (executable === void 0) return { status: "refused" };
    if (this.#verifiedExecutable === executable)
      return { status: "ok", executable };
    const result2 = await this.#exec(executable, ["version"]);
    if (await this.#canonicalExecutable() !== executable)
      return { status: "refused" };
    if (result2.timedOut || result2.exitCode === void 0 || Buffer.byteLength(result2.output, "utf8") > BD_PROCESS_MAX_OUTPUT_BYTES)
      return { status: "unavailable" };
    if (result2.exitCode !== 0 || !/^bd version 1\.1\.0(?:\s|$)/u.test(result2.output))
      return { status: "refused" };
    this.#verifiedExecutable = executable;
    return { status: "ok", executable };
  }
  async #canonicalExecutable() {
    if (this.#executablePoisoned) return void 0;
    const snapshot = await executableSnapshot(this.#executable);
    if (snapshot === void 0)
      return this.#process === runPinnedBd ? void 0 : this.#executable;
    if (this.#executableSnapshot !== void 0 && this.#executableSnapshot.fingerprint !== snapshot.fingerprint) {
      this.#executablePoisoned = true;
      return void 0;
    }
    this.#executableSnapshot ??= snapshot;
    return snapshot.canonical;
  }
  async #canonicalWorkspace() {
    if (this.#process !== runPinnedBd) return this.#workspace;
    try {
      const canonical2 = await realpath(this.#workspace);
      return (await stat(canonical2)).isDirectory() ? canonical2 : void 0;
    } catch {
      return void 0;
    }
  }
  /**
   * `bd context --json` v1 has no prefix field. Bind the remaining immutable
   * project identity with a fixed, read-only lookup of its built-in slot.
   * The command accepts only the validated declared prefix and does not alter
   * the server, so a mismatched workspace fails before slot mutation/CAS.
   */
  async #workspacePrefixMatches(executable, workspace, prefix) {
    if (this.#process !== runPinnedBd) return true;
    try {
      const result2 = await this.#exec(executable, [
        "-C",
        workspace,
        "show",
        `${prefix}-merge-slot`,
        "--json"
      ]);
      if (result2.timedOut || result2.exitCode === void 0 || Buffer.byteLength(result2.output, "utf8") > BD_PROCESS_MAX_OUTPUT_BYTES)
        return "unavailable";
      if (result2.exitCode !== 0) return "unavailable";
      const parsed = JSON.parse(result2.output);
      const issue = Array.isArray(parsed) ? parsed[0] : parsed;
      return issue !== null && typeof issue === "object" && !Array.isArray(issue) && issue.id === `${prefix}-merge-slot`;
    } catch {
      return false;
    }
  }
  #matchesContext(context, identity2, workspace) {
    const endpoint = `${String(context.server_host ?? "")}:${String(context.server_port ?? "")}`;
    if (context.backend !== "dolt" || context.database !== identity2.database || context.dolt_mode !== "server" || endpoint !== identity2.endpoint || typeof context.beads_dir !== "string" || !isAbsolute5(context.beads_dir))
      return false;
    if (identity2.topology === "managed_local_shared_server" && this.#runtimeEnvironment === void 0 || identity2.topology === "external_server" && this.#credentialEnvironment === void 0)
      return false;
    return context.beads_dir === join3(workspace, ".beads");
  }
  async #exec(executable, argv, additionalPath = []) {
    const source = this.#credentialEnvironment?.();
    const runtime = this.#runtimeEnvironment?.();
    const password = source?.BEADS_DOLT_PASSWORD;
    if (password !== void 0 && !safeText(password, 4096))
      return { exitCode: void 0, output: "", timedOut: false };
    if (runtime !== void 0 && (Object.keys(runtime).some(
      (key) => key !== "HOME" && key !== "XDG_CONFIG_HOME"
    ) || runtime.HOME !== void 0 && (!isAbsolute5(runtime.HOME) || !safeText(runtime.HOME, 4096)) || runtime.XDG_CONFIG_HOME !== void 0 && (!isAbsolute5(runtime.XDG_CONFIG_HOME) || !safeText(runtime.XDG_CONFIG_HOME, 4096))))
      return { exitCode: void 0, output: "", timedOut: false };
    return this.#process({
      argv,
      executable,
      env: {
        BD_NON_INTERACTIVE: "1",
        ...password === void 0 ? {} : { BEADS_DOLT_PASSWORD: password },
        CI: "1",
        ...runtime?.HOME === void 0 ? {} : { HOME: runtime.HOME },
        PATH: [dirname4(executable), ...additionalPath, "/usr/bin", "/bin"].join(
          ":"
        ),
        ...runtime?.XDG_CONFIG_HOME === void 0 ? {} : { XDG_CONFIG_HOME: runtime.XDG_CONFIG_HOME }
      },
      timeoutMs: BD_PROCESS_TIMEOUT_MS
    });
  }
};
async function runPinnedBd(request) {
  return new Promise((resolve5) => {
    const child = spawn4(request.executable, request.argv, {
      env: request.env,
      stdio: ["ignore", "pipe", "ignore"]
    });
    let output = "";
    let capped = false;
    let failed = false;
    let timedOut = false;
    let closing = false;
    let killTimer;
    const terminate = () => {
      if (closing) return;
      closing = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, PROCESS_TERM_GRACE_MS);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, request.timeoutMs);
    child.stdout.on("data", (chunk) => {
      if (capped) return;
      output += chunk.toString("utf8");
      if (Buffer.byteLength(output, "utf8") > BD_PROCESS_MAX_OUTPUT_BYTES) {
        capped = true;
        terminate();
      }
    });
    child.once("error", () => {
      failed = true;
      terminate();
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (killTimer !== void 0) clearTimeout(killTimer);
      resolve5({
        exitCode: capped || timedOut || failed ? void 0 : code ?? void 0,
        output,
        timedOut: capped || timedOut
      });
    });
  });
}
function slotScopeReference(scope) {
  return `sce-scope:v1:${deriveScopeCommitment(scope)}`;
}
function serverSlotTransitionKey(input) {
  return createHash4("sha256").update(
    canonicalJson({
      domain: "sce.beads-server.slot-transition.v1",
      transition: input
    })
  ).digest("hex");
}
function makeServerSlotTransitionIntent(input) {
  const withoutKey = {
    after: input.after,
    before: input.before,
    holder: input.holder,
    kind: input.kind,
    precondition: {
      kind: input.kind === "acquire" ? "available" : "held",
      observationHash: input.before.readbackHash
    },
    schema: "sce.beads-server.slot-transition",
    scope: input.scope,
    topology: "shared-server",
    version: 1
  };
  const candidate = {
    ...withoutKey,
    idempotencyKey: serverSlotTransitionKey(withoutKey)
  };
  return validateServerSlotTransitionIntent(
    candidate,
    input.after.slotId.slice(0, -"-merge-slot".length),
    input.scope,
    input.holder,
    input.kind
  ) ? candidate : void 0;
}
function validateServerSlotTransitionIntent(input, prefix, scope, holder4, kind) {
  const parsed = validate(
    ServerSlotTransitionIntentSchema,
    input
  );
  if (!parsed.ok || parsed.value === void 0) return false;
  const transition = parsed.value;
  const before = validateMergeSlotObservation(transition.before, prefix, scope);
  const after = validateMergeSlotObservation(transition.after, prefix, scope);
  if (!before.ok || !after.ok || transition.kind !== kind || transition.holder !== holder4 || !exact(transition.scope, scope) || transition.precondition.observationHash !== before.value.readbackHash || transition.idempotencyKey !== serverSlotTransitionKey({
    after: transition.after,
    before: transition.before,
    holder: transition.holder,
    kind: transition.kind,
    precondition: transition.precondition,
    schema: transition.schema,
    scope: transition.scope,
    topology: transition.topology,
    version: transition.version
  }))
    return false;
  return kind === "acquire" ? transition.precondition.kind === "available" && before.value.status === "available" && before.value.actor === holder4 && after.value.status === "acquired" && after.value.actor === holder4 && after.value.holder === holder4 : transition.precondition.kind === "held" && before.value.status === "acquired" && before.value.actor === holder4 && before.value.holder === holder4 && after.value.status === "available" && after.value.actor === holder4;
}
var PinnedBdManagedServerProcess = class {
  #dataDirectory;
  #doltExecutable;
  #executable;
  #process;
  #runtimeEnvironment;
  #workspace;
  #doltPoisoned = false;
  #doltSnapshot;
  #executablePoisoned = false;
  #executableSnapshot;
  #verifiedDolt;
  #verifiedExecutable;
  constructor(input) {
    if (!isAbsolute5(input.dataDirectory) || !isAbsolute5(input.doltExecutable) || !isAbsolute5(input.executable) || !isAbsolute5(input.workspace))
      throw new Error("invalid pinned managed bd process configuration");
    this.#dataDirectory = input.dataDirectory;
    this.#doltExecutable = input.doltExecutable;
    this.#executable = input.executable;
    this.#process = input.process ?? runPinnedBd;
    this.#runtimeEnvironment = input.runtimeEnvironment;
    this.#workspace = input.workspace;
  }
  async start() {
    const executable = await this.#verify();
    if (executable === void 0) return { status: "refused" };
    const dolt = await this.#verifyDolt();
    if (dolt === void 0) return { status: "refused" };
    const workspace = await this.#canonicalWorkspace();
    if (workspace === void 0) return { status: "refused" };
    if (await this.#canonicalExecutable() !== executable || await this.#canonicalDolt() !== dolt)
      return { status: "refused" };
    const before = await this.#status(executable, dolt, workspace);
    if (before === void 0) return { status: "refused" };
    if (before === "running") return { status: "ok", value: void 0 };
    if (await this.#canonicalExecutable() !== executable || await this.#canonicalDolt() !== dolt)
      return { status: "refused" };
    const result2 = await this.#exec(
      executable,
      ["-C", workspace, "dolt", "start"],
      [dirname4(dolt)]
    );
    if (result2.timedOut || result2.exitCode === void 0)
      return { status: "unavailable" };
    if (result2.exitCode !== 0) return { status: "refused" };
    if (await this.#canonicalExecutable() !== executable || await this.#canonicalDolt() !== dolt)
      return { status: "refused" };
    if (await this.#status(executable, dolt, workspace) !== "running")
      return { status: "refused" };
    return { status: "ok", value: void 0 };
  }
  async #verify() {
    const executable = await this.#canonicalExecutable();
    if (executable === void 0) return void 0;
    if (this.#verifiedExecutable === executable) return executable;
    const result2 = await this.#exec(executable, ["version"]);
    if (await this.#canonicalExecutable() !== executable) return void 0;
    if (result2.timedOut || result2.exitCode !== 0 || Buffer.byteLength(result2.output, "utf8") > BD_PROCESS_MAX_OUTPUT_BYTES || !/^bd version 1\.1\.0(?:\s|$)/u.test(result2.output))
      return void 0;
    this.#verifiedExecutable = executable;
    return executable;
  }
  async #canonicalExecutable() {
    if (this.#executablePoisoned) return void 0;
    const snapshot = await executableSnapshot(this.#executable);
    if (snapshot === void 0)
      return this.#process === runPinnedBd ? void 0 : this.#executable;
    if (this.#executableSnapshot !== void 0 && this.#executableSnapshot.fingerprint !== snapshot.fingerprint) {
      this.#executablePoisoned = true;
      return void 0;
    }
    this.#executableSnapshot ??= snapshot;
    return snapshot.canonical;
  }
  async #verifyDolt() {
    const dolt = await this.#canonicalDolt();
    if (dolt === void 0) return void 0;
    if (this.#verifiedDolt === dolt) return dolt;
    const result2 = await this.#exec(dolt, ["version"]);
    if (await this.#canonicalDolt() !== dolt) return void 0;
    if (result2.timedOut || result2.exitCode !== 0 || Buffer.byteLength(result2.output, "utf8") > DOLT_SQL_MAX_OUTPUT_BYTES || !/^dolt version 2\.2\.1(?:\s|$)/u.test(result2.output))
      return void 0;
    this.#verifiedDolt = dolt;
    return dolt;
  }
  async #canonicalDolt() {
    if (this.#doltPoisoned) return void 0;
    const snapshot = await executableSnapshot(this.#doltExecutable);
    if (snapshot === void 0)
      return this.#process === runPinnedBd ? void 0 : this.#doltExecutable;
    if (this.#doltSnapshot !== void 0 && this.#doltSnapshot.fingerprint !== snapshot.fingerprint) {
      this.#doltPoisoned = true;
      return void 0;
    }
    this.#doltSnapshot ??= snapshot;
    return snapshot.canonical;
  }
  async #status(executable, dolt, workspace) {
    if (await this.#canonicalExecutable() !== executable || await this.#canonicalDolt() !== dolt)
      return void 0;
    const result2 = await this.#exec(
      executable,
      ["-C", workspace, "dolt", "status", "--json"],
      [dirname4(dolt)]
    );
    if (result2.timedOut || result2.exitCode !== 0 || Buffer.byteLength(result2.output, "utf8") > BD_PROCESS_MAX_OUTPUT_BYTES)
      return void 0;
    try {
      const parsed = JSON.parse(result2.output);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).sort().join(",") !== "data_dir,pid,port,running,schema_version")
        return void 0;
      const value = parsed;
      if (value.schema_version !== 1 || typeof value.running !== "boolean")
        return void 0;
      if (!value.running)
        return value.data_dir === "" && value.pid === 0 && value.port === 0 ? "stopped" : void 0;
      if (typeof value.data_dir !== "string" || !isAbsolute5(value.data_dir) || typeof value.pid !== "number" || !Number.isSafeInteger(value.pid) || value.pid <= 0 || typeof value.port !== "number" || !Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65535)
        return void 0;
      const [actual, expected] = await Promise.all([
        realpath(value.data_dir),
        realpath(this.#dataDirectory)
      ]);
      return actual === expected ? "running" : void 0;
    } catch {
      return void 0;
    }
  }
  async #canonicalWorkspace() {
    try {
      const canonical2 = await realpath(this.#workspace);
      return (await stat(canonical2)).isDirectory() ? canonical2 : void 0;
    } catch {
      return void 0;
    }
  }
  async #exec(executable, argv, additionalPath = []) {
    const runtime = this.#runtimeEnvironment?.();
    if (runtime !== void 0 && (Object.keys(runtime).some(
      (key) => key !== "HOME" && key !== "XDG_CONFIG_HOME"
    ) || runtime.HOME !== void 0 && (!isAbsolute5(runtime.HOME) || !safeText(runtime.HOME, 4096)) || runtime.XDG_CONFIG_HOME !== void 0 && (!isAbsolute5(runtime.XDG_CONFIG_HOME) || !safeText(runtime.XDG_CONFIG_HOME, 4096))))
      return { exitCode: void 0, output: "", timedOut: false };
    return this.#process({
      argv,
      executable,
      env: {
        BD_NON_INTERACTIVE: "1",
        CI: "1",
        ...runtime?.HOME === void 0 ? {} : { HOME: runtime.HOME },
        PATH: [dirname4(executable), ...additionalPath, "/usr/bin", "/bin"].join(
          ":"
        ),
        ...runtime?.XDG_CONFIG_HOME === void 0 ? {} : { XDG_CONFIG_HOME: runtime.XDG_CONFIG_HOME }
      },
      timeoutMs: BD_PROCESS_TIMEOUT_MS
    });
  }
};
function safeText(value, max) {
  return bytes.encode(value).byteLength > 0 && bytes.encode(value).byteLength <= max && !value.includes("\0") && !containsSecretShape(value);
}
function exact(left, right) {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}
function safeRecord(input, keys) {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input))
      return void 0;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return void 0;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some((key) => typeof key !== "string")) return void 0;
    const actual = ownKeys;
    actual.sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
      return void 0;
    const record2 = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (descriptor === void 0 || !("value" in descriptor))
        return void 0;
      record2[key] = descriptor.value;
    }
    return record2;
  } catch {
    return void 0;
  }
}
function safeOptionalRecord(input, required2, optional) {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input))
      return void 0;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return void 0;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some((key) => typeof key !== "string")) return void 0;
    const actual = ownKeys;
    actual.sort();
    const allowed = /* @__PURE__ */ new Set([...required2, ...optional]);
    if (actual.some((key) => !allowed.has(key)) || required2.some((key) => !actual.includes(key)))
      return void 0;
    const record2 = {};
    for (const key of actual) {
      const descriptor = descriptors[key];
      if (descriptor === void 0 || !("value" in descriptor))
        return void 0;
      record2[key] = descriptor.value;
    }
    return record2;
  } catch {
    return void 0;
  }
}
function validIdentifier(value, max = MAX_SCHEMA_BYTES) {
  return safeText(value, max) && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(value);
}
function mapFailure(failure2) {
  if (failure2 === "unavailable") return "unavailable";
  if (failure2 === "ambiguous") return "ambiguous";
  return "quarantined";
}
function sameServerIdentity(identity2, probe) {
  return identity2.endpoint === probe.endpoint && identity2.database === probe.database && identity2.schema === probe.schema && identity2.autoCommitPolicy === probe.autoCommitPolicy && identity2.credentialReference === probe.credentialReference && probe.workerGrant.credentialReference === identity2.workerCredentialReference && identity2.workerCredentialReference !== identity2.credentialReference;
}
var ServerProbeSchema = strictObject2({
  autoCommitPolicy: Type.Union([
    Type.Literal("on"),
    Type.Literal("off"),
    Type.Literal("batch")
  ]),
  credentialReference: Type.String({
    minLength: 1,
    maxLength: MAX_FINGERPRINT_BYTES
  }),
  database: Type.String({ minLength: 1, maxLength: MAX_SCHEMA_BYTES }),
  endpoint: Type.String({ minLength: 1, maxLength: MAX_ENDPOINT_BYTES }),
  schema: Type.String({ minLength: 1, maxLength: MAX_SCHEMA_BYTES }),
  workerGrant: strictObject2({
    credentialReference: Type.String({
      minLength: 1,
      maxLength: MAX_FINGERPRINT_BYTES
    }),
    serverEnforced: Type.Boolean(),
    writeDenied: Type.Boolean()
  })
});
var ServerIdentitySchema = strictObject2({
  autoCommitPolicy: Type.Union([
    Type.Literal("on"),
    Type.Literal("off"),
    Type.Literal("batch")
  ]),
  credentialProvenance: Type.Union([
    Type.Literal("environment"),
    Type.Literal("managed_local_runtime")
  ]),
  credentialReference: Type.String({
    minLength: 1,
    maxLength: MAX_FINGERPRINT_BYTES
  }),
  database: Type.String({ minLength: 1, maxLength: MAX_SCHEMA_BYTES }),
  endpoint: Type.String({ minLength: 1, maxLength: MAX_ENDPOINT_BYTES }),
  prefix: Type.String({ minLength: 1, maxLength: MAX_SCHEMA_BYTES }),
  schema: Type.String({ minLength: 1, maxLength: MAX_SCHEMA_BYTES }),
  topology: Type.Union([
    Type.Literal("managed_local_shared_server"),
    Type.Literal("external_server")
  ]),
  transportSecurity: Type.Union([
    Type.Literal("tls"),
    Type.Literal("loopback_plaintext")
  ]),
  workerCredentialReference: Type.String({
    minLength: 1,
    maxLength: MAX_FINGERPRINT_BYTES
  })
});
var ServerCommitReadbackSchema = strictObject2({
  autoCommitPolicy: Type.Union([
    Type.Literal("on"),
    Type.Literal("off"),
    Type.Literal("batch")
  ]),
  commit: Type.Union([Type.Literal("auto"), Type.Literal("explicit")]),
  head: Type.Optional(
    Type.String({
      minLength: 20,
      maxLength: 64,
      pattern: "^[0-9a-z]{20,64}$"
    })
  ),
  workingSet: Type.Literal("clean")
});
function parseProbe(input) {
  return isSchema(ServerProbeSchema, input) ? input : void 0;
}
function parseCommit(input) {
  return isSchema(ServerCommitReadbackSchema, input) ? input : void 0;
}
function normalizedServerIdentity(input) {
  const record2 = safeRecord(input, [
    "autoCommitPolicy",
    "credentialProvenance",
    "credentialReference",
    "database",
    "endpoint",
    "prefix",
    "schema",
    "topology",
    "transportSecurity",
    "workerCredentialReference"
  ]);
  try {
    return record2 !== void 0 && isSchema(ServerIdentitySchema, record2) ? record2 : void 0;
  } catch {
    return void 0;
  }
}
function normalizedScope(input) {
  const record2 = safeRecord(input, [
    "beadsStoreIdentity",
    "gitRepositoryIdentity",
    "integrationBranch"
  ]);
  try {
    return record2 !== void 0 && isSchema(FencingScopeSchema, record2) ? record2 : void 0;
  } catch {
    return void 0;
  }
}
function normalizedJsonValue(input) {
  try {
    return JSON.parse(canonicalJson(input));
  } catch {
    return void 0;
  }
}
function parseResult(input) {
  if (!isSchema(RunStoreResultSchema, input)) return void 0;
  const result2 = input;
  if (result2.status !== "applied") return result2;
  if (!validateRootProjection(result2.root).ok || !isSchema(CheckpointObservationSchema, result2.checkpoint))
    return void 0;
  return result2.children.every((child) => validateChildProjection(child).ok) ? result2 : void 0;
}
function parseSlotReadback(input, prefix, scope) {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    return void 0;
  const value = input;
  if (Object.keys(value).sort().join(",") !== "observation,scopeReference" || value.scopeReference !== slotScopeReference(scope))
    return void 0;
  const slot = validateMergeSlotObservation(value.observation, prefix, scope);
  return slot.ok ? slot.value : void 0;
}
function parseDiscovery(input, prefix, scope) {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    return void 0;
  const value = input;
  if (Object.keys(value).sort().join(",") === "slot,status") {
    const slot2 = validateMergeSlotObservation(value.slot, prefix, scope);
    return value.status === "absent" && slot2.ok && slot2.value.status === "available" ? { status: "absent", slot: slot2.value } : void 0;
  }
  if (Object.keys(value).sort().join(",") !== "checkpoint,children,root,slot" || !Array.isArray(value.children))
    return void 0;
  const root = validateRootProjection(value.root);
  const slot = validateMergeSlotObservation(value.slot, prefix, scope);
  if (!root.ok || !slot.ok || !isSchema(CheckpointObservationSchema, value.checkpoint) || !exact(root.value.checkpoint, value.checkpoint) || value.children.length !== root.value.childRows.length)
    return void 0;
  const expectedUnitIds = new Set(
    root.value.childRows.map((child) => child.unitId)
  );
  const observedUnitIds = /* @__PURE__ */ new Set();
  for (const child of value.children) {
    const parsed = validateChildProjection(child);
    const reference = parsed.ok ? root.value.childRows.find((row) => row.unitId === parsed.value.unitId) : void 0;
    if (!parsed.ok || observedUnitIds.has(parsed.value.unitId) || reference?.revision !== parsed.value.revision || reference.commitment !== parsed.value.commitment)
      return void 0;
    observedUnitIds.add(parsed.value.unitId);
  }
  if (observedUnitIds.size !== expectedUnitIds.size || [...expectedUnitIds].some((unitId) => !observedUnitIds.has(unitId)))
    return void 0;
  return {
    checkpoint: value.checkpoint,
    children: value.children,
    root: value.root,
    slot: value.slot
  };
}
function boundedMutationBatch(value) {
  try {
    return Buffer.byteLength(canonicalJson(value), "utf8") <= MUTATION_BATCH_MAX_BYTES;
  } catch {
    return false;
  }
}
function normalizedMutationBatch(input) {
  try {
    const parsed = validateMutationBatch(input);
    if (!parsed.ok || !boundedMutationBatch(parsed.value)) return void 0;
    const normalized = JSON.parse(
      canonicalJson(parsed.value)
    );
    const reparsed = validateMutationBatch(normalized);
    return reparsed.ok && boundedMutationBatch(reparsed.value) ? reparsed.value : void 0;
  } catch {
    return void 0;
  }
}
var BeadsServerAdapter = class {
  #driver;
  #identity;
  #process;
  #recoveryScope;
  #ready = false;
  #started = false;
  #lastDiscovery;
  constructor(input) {
    if (input.identity.topology === "external_server" && input.process !== void 0 || input.identity.topology === "managed_local_shared_server" && input.identity.credentialProvenance !== "managed_local_runtime")
      throw new Error("invalid server adapter topology");
    this.#driver = input.driver;
    this.#identity = input.identity;
    this.#process = input.process;
    this.#recoveryScope = input.recoveryScope;
  }
  /**
   * A readback is usable only after the concrete driver has reproved its live
   * identity and returned every exact root/child projection. Absence is never
   * inferred from an outage or malformed response.
   */
  async load() {
    if (!this.#ready || this.#recoveryScope === void 0)
      return { status: "quarantined" };
    let response;
    try {
      response = await this.#driver.discover({
        identity: this.#identity,
        prefix: this.#identity.prefix,
        scope: this.#recoveryScope
      });
    } catch {
      this.#revoke();
      return { status: "ambiguous" };
    }
    if (response.status !== "ok") {
      this.#revoke();
      return response.status === "unavailable" ? { status: "unavailable" } : response.status === "ambiguous" ? { status: "ambiguous" } : { status: "quarantined" };
    }
    const parsed = parseDiscovery(
      response.value,
      this.#identity.prefix,
      this.#recoveryScope
    );
    if (parsed === void 0) {
      this.#revoke();
      return { status: "corrupt" };
    }
    if ("status" in parsed) return { status: "absent" };
    const root = validateRootProjection(parsed.root);
    if (!root.ok) {
      this.#revoke();
      return { status: "corrupt" };
    }
    const children = [];
    for (const child of parsed.children) {
      const parsedChild = validateChildProjection(child);
      if (!parsedChild.ok) {
        this.#revoke();
        return { status: "corrupt" };
      }
      children.push(parsedChild.value);
    }
    if (children.length !== root.value.childRows.length) {
      this.#revoke();
      return { status: "corrupt" };
    }
    return {
      status: "observed",
      value: {
        children,
        root: root.value
      }
    };
  }
  async preflight() {
    this.#revoke();
    if (this.#identity.topology === "managed_local_shared_server" && !this.#started) {
      if (this.#process === void 0)
        return { status: "refused", code: "BS_SERVER_REFUSED" };
      let started;
      try {
        started = await this.#process.start();
      } catch {
        this.#revoke();
        return { status: "unavailable", code: "BS_SERVER_UNAVAILABLE" };
      }
      if (started.status !== "ok") {
        this.#revoke();
        return this.#preflightFailure(started.status);
      }
      this.#started = true;
    }
    let probe;
    try {
      probe = await this.#driver.probe(this.#identity);
    } catch {
      this.#revoke();
      return { status: "unavailable", code: "BS_SERVER_UNAVAILABLE" };
    }
    if (probe.status !== "ok") {
      this.#revoke();
      return this.#preflightFailure(probe.status);
    }
    const parsed = parseProbe(probe.value);
    if (parsed === void 0 || !sameServerIdentity(this.#identity, parsed)) {
      this.#revoke();
      return { status: "refused", code: "BS_IDENTITY_MISMATCH" };
    }
    if (!parsed.workerGrant.serverEnforced || !parsed.workerGrant.writeDenied) {
      this.#revoke();
      return { status: "refused", code: "BS_READ_ONLY_NOT_ENFORCED" };
    }
    this.#ready = true;
    return { status: "ready", identity: this.#identity };
  }
  async dispose() {
    this.#revoke();
    this.#started = false;
  }
  async acquire(input) {
    this.#lastDiscovery = void 0;
    if (!this.#ready) return { status: "quarantined" };
    let checked;
    try {
      checked = await this.#driver.mergeSlotCheck({
        actor: input.knownHolder ?? input.holder,
        prefix: input.prefix,
        scope: input.scope
      });
    } catch {
      this.#revoke();
      return { status: "ambiguous" };
    }
    if (checked.status !== "ok") {
      this.#revoke();
      return { status: mapFailure(checked.status) };
    }
    const before = parseSlotReadback(checked.value, input.prefix, input.scope);
    if (before === void 0) {
      this.#revoke();
      return { status: "quarantined" };
    }
    const decision = decideControllerSlot(
      input.prefix,
      input.scope,
      input.holder,
      input.knownHolder,
      before,
      input.continuationEvidence,
      input.releaseEvidence
    );
    if (decision.kind === "resume" || decision.kind === "continue")
      return { status: decision.kind, slot: before };
    if (decision.kind === "blocked") return { status: "blocked" };
    if (decision.kind === "quarantined") {
      this.#revoke();
      return { status: "quarantined" };
    }
    let result2;
    try {
      result2 = await this.#driver.mergeSlotAcquire({
        actor: input.holder,
        prefix: input.prefix,
        scope: input.scope
      });
    } catch {
      this.#revoke();
      return { status: "ambiguous" };
    }
    if (result2.status !== "ok") {
      this.#revoke();
      return { status: mapFailure(result2.status) };
    }
    const after = parseSlotReadback(result2.value, input.prefix, input.scope);
    if (after === void 0) {
      this.#revoke();
      return { status: "quarantined" };
    }
    if (after.status === "acquired" && after.holder === input.holder && after.actor === input.holder)
      return { status: "acquired", slot: after };
    if (after.status === "acquired") return { status: "blocked" };
    this.#revoke();
    return { status: "quarantined" };
  }
  async check(input) {
    this.#lastDiscovery = void 0;
    if (!this.#ready) return { status: "quarantined" };
    let result2;
    try {
      result2 = await this.#driver.mergeSlotCheck({
        actor: input.holder,
        prefix: input.prefix,
        scope: input.scope
      });
    } catch {
      this.#revoke();
      return { status: "ambiguous" };
    }
    if (result2.status !== "ok") {
      this.#revoke();
      return { status: mapFailure(result2.status) };
    }
    const parsed = parseSlotReadback(result2.value, input.prefix, input.scope);
    if (parsed === void 0) {
      this.#revoke();
      return { status: "quarantined" };
    }
    return parsed.status === "acquired" && parsed.holder === input.holder ? { status: "resume", slot: parsed } : { status: "blocked" };
  }
  async release(input) {
    this.#lastDiscovery = void 0;
    if (!this.#ready) return { status: "quarantined" };
    let result2;
    try {
      result2 = await this.#driver.mergeSlotRelease({
        actor: input.holder,
        prefix: input.prefix,
        scope: input.scope
      });
    } catch {
      this.#revoke();
      return { status: "ambiguous" };
    }
    if (result2.status !== "ok") {
      this.#revoke();
      return { status: mapFailure(result2.status) };
    }
    const evidence = validateSlotRelease(
      input.prefix,
      input.scope,
      input.holder,
      {
        holder: input.holder,
        readback: result2.value.observation
      }
    );
    if (!evidence.ok) {
      this.#revoke();
      return { status: "quarantined" };
    }
    return { status: "released", slot: result2.value.observation };
  }
  /** Read-only topology planning for a fresh persisted controller intent. */
  async prepareControllerTransition(input) {
    this.#lastDiscovery = void 0;
    if (!this.#ready || this.#recoveryScope === void 0 || !exact(input.scope, this.#recoveryScope))
      return { status: "quarantined" };
    let result2;
    try {
      result2 = await this.#driver.mergeSlotCheck({
        actor: input.holder,
        prefix: this.#identity.prefix,
        scope: input.scope
      });
    } catch {
      this.#revoke();
      return { status: "ambiguous" };
    }
    if (result2.status !== "ok") {
      this.#revoke();
      return {
        status: result2.status === "unavailable" ? "unavailable" : "ambiguous"
      };
    }
    const before = parseSlotReadback(
      result2.value,
      this.#identity.prefix,
      input.scope
    );
    if (before === void 0 || input.kind === "acquire" && before.status !== "available" || input.kind === "release" && (before.status !== "acquired" || before.holder !== input.holder))
      return before?.status === "acquired" ? { status: "blocked" } : { status: "ambiguous" };
    const withoutHash = {
      ...before,
      actor: input.holder,
      ...input.kind === "acquire" ? { holder: input.holder } : {},
      status: input.kind === "acquire" ? "acquired" : "available"
    };
    if (input.kind === "release")
      delete withoutHash.holder;
    const { readbackHash: _ignored, ...hashInput } = withoutHash;
    const after = {
      ...hashInput,
      readbackHash: deriveSlotReadbackHash(hashInput)
    };
    const transition = makeServerSlotTransitionIntent({
      after,
      before,
      holder: input.holder,
      kind: input.kind,
      scope: input.scope
    });
    return transition === void 0 ? { status: "quarantined" } : { status: "planned", transition };
  }
  /**
   * Read-only reconciliation of an already-persisted server transition.
   * Exact `before` is positive retry authority; exact `after` is completion.
   * No acquire or release command is reachable from this method.
   */
  async reconcileControllerTransition(transition) {
    this.#lastDiscovery = void 0;
    if (!this.#ready || !validateServerSlotTransitionIntent(
      transition,
      this.#identity.prefix,
      transition.scope,
      transition.holder,
      transition.kind
    ))
      return { status: "ambiguous" };
    let result2;
    try {
      result2 = await this.#driver.mergeSlotCheck({
        actor: transition.holder,
        prefix: this.#identity.prefix,
        scope: transition.scope
      });
    } catch {
      this.#revoke();
      return { status: "ambiguous" };
    }
    if (result2.status !== "ok") {
      this.#revoke();
      return {
        status: result2.status === "unavailable" ? "unavailable" : "ambiguous"
      };
    }
    const current = parseSlotReadback(
      result2.value,
      this.#identity.prefix,
      transition.scope
    );
    if (current === void 0) {
      this.#revoke();
      return { status: "ambiguous" };
    }
    if (exact(current, transition.after)) return { status: "observed" };
    if (exact(current, transition.before)) return { status: "absent" };
    return current.status === "acquired" && current.holder !== transition.holder ? { status: "blocked" } : { status: "ambiguous" };
  }
  /**
   * Execute only the exact server transition which survived journal
   * validation. The coordinator calls this solely after read-only reconcile
   * proved the exact `before` observation.
   */
  async executeControllerTransition(transition) {
    this.#lastDiscovery = void 0;
    if (!this.#ready || !validateServerSlotTransitionIntent(
      transition,
      this.#identity.prefix,
      transition.scope,
      transition.holder,
      transition.kind
    ))
      return { status: "ambiguous" };
    let result2;
    try {
      result2 = transition.kind === "acquire" ? await this.#driver.mergeSlotAcquire({
        actor: transition.holder,
        prefix: this.#identity.prefix,
        scope: transition.scope
      }) : await this.#driver.mergeSlotRelease({
        actor: transition.holder,
        prefix: this.#identity.prefix,
        scope: transition.scope
      });
    } catch {
      this.#revoke();
      return { status: "ambiguous" };
    }
    if (result2.status !== "ok") {
      this.#revoke();
      return {
        status: result2.status === "unavailable" ? "unavailable" : "ambiguous"
      };
    }
    const after = parseSlotReadback(
      result2.value,
      this.#identity.prefix,
      transition.scope
    );
    if (after === void 0) {
      this.#revoke();
      return { status: "ambiguous" };
    }
    if (exact(after, transition.after)) return { status: "observed" };
    return after.status === "acquired" && after.holder !== transition.holder ? { status: "blocked" } : { status: "ambiguous" };
  }
  /** Exact server readback used to reconcile, never to blindly retry a commit. */
  async discover(scope) {
    this.#lastDiscovery = void 0;
    try {
      const response = await this.#driver.discover({
        identity: this.#identity,
        prefix: this.#identity.prefix,
        scope
      });
      if (response.status !== "ok") {
        this.#revoke();
        return void 0;
      }
      const parsed = parseDiscovery(
        response.value,
        this.#identity.prefix,
        scope
      );
      if (parsed === void 0) {
        this.#revoke();
        return void 0;
      }
      if ("status" in parsed) return void 0;
      this.#lastDiscovery = parsed;
      return parsed;
    } catch {
      this.#revoke();
      return void 0;
    }
  }
  get lastDiscovery() {
    return this.#lastDiscovery;
  }
  async compareAndSet(batchInput) {
    this.#lastDiscovery = void 0;
    if (!this.#ready) return { status: "quarantined" };
    const batch = validateMutationBatch(batchInput);
    if (!batch.ok || !boundedMutationBatch(batch.value)) {
      this.#revoke();
      return { status: "quarantined" };
    }
    let response;
    try {
      response = await this.#driver.mutate({
        batch: batch.value,
        identity: this.#identity
      });
    } catch {
      this.#revoke();
      await this.discover(batch.value.scope);
      return { status: "ambiguous" };
    }
    if (response.status !== "ok") {
      this.#revoke();
      await this.discover(batch.value.scope);
      return {
        status: response.phase === "before_transaction" && response.status === "unavailable" ? "unavailable" : "ambiguous"
      };
    }
    const commit2 = parseCommit(response.value.commit);
    const result2 = parseResult(response.value.result);
    if (commit2 === void 0 || result2 === void 0 || !this.#durable(commit2)) {
      this.#revoke();
      return { status: "quarantined" };
    }
    if (result2.status !== "applied") return result2;
    if (result2.affectedRowCount !== batch.value.changedRows.length + 1 || !exact(result2.root, batch.value.next.root) || !exact(result2.children, batch.value.next.children) || !exact(result2.checkpoint, batch.value.checkpoint)) {
      this.#revoke();
      return { status: "quarantined" };
    }
    return result2;
  }
  /**
   * The sole existing-root pre-ownership write.  It intentionally does not
   * delegate to compareAndSet: ordinary CAS predicates require the slot to be
   * acquired, whereas this operation proves it remains exactly available.
   */
  async persistControllerAcquireIntent(batchInput) {
    this.#lastDiscovery = void 0;
    if (!this.#ready || this.#driver.preOwnershipMutate === void 0)
      return { status: "quarantined" };
    const batch = validateMutationBatch(batchInput);
    if (!batch.ok || !boundedMutationBatch(batch.value)) {
      this.#revoke();
      return { status: "quarantined" };
    }
    const prior = batch.value.next.root.run;
    const transition = prior.effectJournal.at(-1)?.slotTransition;
    if (prior.state !== "initializing" || prior.controller.state !== "acquire_intent" || prior.effectJournal.at(-1)?.kind !== "controller_acquire" || prior.effectJournal.at(-1)?.status !== "intended" || !validateServerSlotTransitionIntent(
      transition,
      this.#identity.prefix,
      batch.value.scope,
      batch.value.expectedHolder,
      "acquire"
    )) {
      this.#revoke();
      return { status: "quarantined" };
    }
    return this.#preOwnershipResult(
      { kind: "existing", batch: batch.value },
      batch.value
    );
  }
  /**
   * Atomic bootstrap used only when authoritative discovery proved every SCE
   * projection absent. The concrete driver checks those absences and the
   * available slot in the same SQL transaction, then readbacks the exact
   * intended projection before returning applied.
   */
  async createControllerAcquireIntent(input) {
    this.#lastDiscovery = void 0;
    if (!this.#ready || this.#driver.preOwnershipMutate === void 0)
      return { status: "quarantined" };
    const initial = validate(
      InitialControllerAcquireSchema,
      input
    );
    if (!initial.ok || initial.value === void 0) {
      this.#revoke();
      return { status: "quarantined" };
    }
    const candidate = initial.value;
    const transition = candidate.next.root.run.effectJournal[0]?.slotTransition;
    if (!exact(candidate.expected.scope, candidate.next.root.scope) || candidate.expected.holder !== candidate.next.root.holder || candidate.next.root.run.state !== "initializing" || candidate.next.root.run.controller.state !== "acquire_intent" || candidate.next.root.run.effectJournal.length !== 1 || candidate.next.root.run.effectJournal[0]?.kind !== "controller_acquire" || !validateServerSlotTransitionIntent(
      transition,
      this.#identity.prefix,
      candidate.expected.scope,
      candidate.expected.holder,
      "acquire"
    )) {
      this.#revoke();
      return { status: "quarantined" };
    }
    const expected = {
      changedRows: candidate.next.children.map((child) => ({
        expectedCommitment: child.commitment,
        expectedRevision: child.revision,
        nextCommitment: child.commitment,
        nextRevision: child.revision,
        unitId: child.unitId
      })),
      checkpoint: candidate.next.root.checkpoint,
      next: candidate.next
    };
    return this.#preOwnershipResult(
      { kind: "initial", initial: candidate },
      expected
    );
  }
  async #preOwnershipResult(mutation, expected) {
    let response;
    try {
      response = await this.#driver.preOwnershipMutate({
        identity: this.#identity,
        mutation
      });
    } catch {
      this.#revoke();
      return { status: "ambiguous" };
    }
    if (response.status !== "ok") {
      this.#revoke();
      return response.phase === "before_transaction" && response.status === "unavailable" ? { status: "unavailable" } : { status: "ambiguous" };
    }
    const commit2 = parseCommit(response.value.commit);
    const result2 = parseResult(response.value.result);
    if (commit2 === void 0 || result2 === void 0 || !this.#durable(commit2)) {
      this.#revoke();
      return { status: "quarantined" };
    }
    if (result2.status !== "applied") return result2;
    if (result2.affectedRowCount !== expected.changedRows.length + 1 || !exact(result2.root, expected.next.root) || !exact(result2.children, expected.next.children) || !exact(result2.checkpoint, expected.checkpoint)) {
      this.#revoke();
      return { status: "quarantined" };
    }
    return result2;
  }
  #durable(commit2) {
    if (commit2.autoCommitPolicy !== this.#identity.autoCommitPolicy || commit2.workingSet !== "clean")
      return false;
    return this.#identity.autoCommitPolicy === "on" ? commit2.commit === "auto" : commit2.commit === "explicit";
  }
  #preflightFailure(failure2) {
    if (failure2 === "unavailable")
      return { status: "unavailable", code: "BS_SERVER_UNAVAILABLE" };
    if (failure2 === "ambiguous")
      return { status: "ambiguous", code: "BS_SERVER_AMBIGUOUS" };
    return { status: "refused", code: "BS_SERVER_REFUSED" };
  }
  #revoke() {
    this.#ready = false;
    this.#lastDiscovery = void 0;
    try {
      this.#driver.disarm();
    } catch {
    }
  }
};
function quotedIdentifier(value) {
  return validIdentifier(value) ? `\`${value}\`` : void 0;
}
function sqlLiteral(value) {
  if (typeof value === "number") return String(value);
  return `CONVERT(0x${Buffer.from(value, "utf8").toString("hex")} USING utf8mb4)`;
}
function sqlJson(value) {
  const encoded = JSON.stringify(value);
  if (encoded === void 0) throw new Error("invalid SQL JSON value");
  return `CAST(${sqlLiteral(encoded)} AS JSON)`;
}
function jsonRecord(value) {
  let parsed = value;
  try {
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
  } catch {
    return void 0;
  }
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : void 0;
}
function exactWorkerSelectGrants(rows, user, database) {
  const key = `Grants for ${user}@%`;
  const values = rows.map((row) => row[key]);
  const principal = `\`${user}\`@\`%\``;
  const expected = /* @__PURE__ */ new Set([
    `GRANT USAGE ON *.* TO ${principal}`,
    `GRANT SELECT ON \`${database}\`.* TO ${principal}`
  ]);
  return rows.length === expected.size && values.every(
    (value) => typeof value === "string" && expected.delete(value)
  ) && expected.size === 0;
}
var DoltBeadsServerDriver = class {
  #identity;
  #rows;
  #slotProcess;
  #worker;
  #writer;
  #autoCommitObserved = false;
  #doltTransactionCommitObserved = false;
  #ready = false;
  #readyIdentity;
  constructor(input) {
    if (!validIdentifier(input.rows.rootBeadId) || Object.values(input.rows.childBeadIds).some((id) => !validIdentifier(id)))
      throw new Error("invalid server bead rows");
    this.#identity = input.identity;
    this.#rows = input.rows;
    this.#slotProcess = input.slotProcess;
    this.#worker = input.worker;
    this.#writer = input.writer;
  }
  disarm() {
    this.#ready = false;
    this.#readyIdentity = void 0;
    this.#autoCommitObserved = false;
    this.#doltTransactionCommitObserved = false;
  }
  async probe(expectedIdentity) {
    this.disarm();
    const expected = normalizedServerIdentity(expectedIdentity);
    if (expected === void 0 || !exact(expected, this.#identity))
      return { status: "refused" };
    const liveBinding = await this.#liveDiscoveryBinding();
    if (liveBinding.status !== "ok") return liveBinding;
    const issuesTable = await executeDoltSqlRead(
      this.#writer,
      `SELECT table_name FROM information_schema.tables WHERE table_schema = ${sqlLiteral(this.#identity.database)} AND table_name = 'issues'`
    );
    if (issuesTable.status !== "ok") return { status: issuesTable.status };
    if (issuesTable.rows.length !== 1 || issuesTable.rows[0]?.table_name !== "issues" && issuesTable.rows[0]?.TABLE_NAME !== "issues")
      return { status: "refused" };
    const labelsTable = await executeDoltSqlRead(
      this.#writer,
      `SELECT table_name FROM information_schema.tables WHERE table_schema = ${sqlLiteral(this.#identity.database)} AND table_name = 'labels'`
    );
    if (labelsTable.status !== "ok") return { status: labelsTable.status };
    if (labelsTable.rows.length !== 1 || labelsTable.rows[0]?.table_name !== "labels" && labelsTable.rows[0]?.TABLE_NAME !== "labels")
      return { status: "refused" };
    const columns = await executeDoltSqlRead(
      this.#writer,
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = ${sqlLiteral(this.#identity.database)} AND table_name = 'issues'`
    );
    if (columns.status !== "ok") return { status: columns.status };
    const requiredColumns = /* @__PURE__ */ new Map([
      ["id", "varchar"],
      ["status", "varchar"],
      ["metadata", "json"],
      ["external_ref", "varchar"],
      ["title", "varchar"],
      ["design", "longtext"]
    ]);
    for (const row of columns.rows) {
      const name = String(
        row.column_name ?? row.COLUMN_NAME ?? ""
      ).toLowerCase();
      const type = String(row.data_type ?? row.DATA_TYPE ?? "").toLowerCase();
      if (requiredColumns.get(name) === type) requiredColumns.delete(name);
    }
    if (requiredColumns.size !== 0) return { status: "refused" };
    const labelColumns = await executeDoltSqlRead(
      this.#writer,
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = ${sqlLiteral(this.#identity.database)} AND table_name = 'labels'`
    );
    if (labelColumns.status !== "ok") return { status: labelColumns.status };
    const requiredLabelColumns = /* @__PURE__ */ new Map([
      ["issue_id", "varchar"],
      ["label", "varchar"]
    ]);
    for (const row of labelColumns.rows) {
      const name = String(
        row.column_name ?? row.COLUMN_NAME ?? ""
      ).toLowerCase();
      const type = String(row.data_type ?? row.DATA_TYPE ?? "").toLowerCase();
      if (requiredLabelColumns.get(name) === type)
        requiredLabelColumns.delete(name);
    }
    if (requiredLabelColumns.size !== 0) return { status: "refused" };
    const autoCommit2 = await executeDoltSqlRead(
      this.#writer,
      "SELECT @@autocommit AS auto_commit"
    );
    if (autoCommit2.status !== "ok" || autoCommit2.rows.length !== 1 || String(autoCommit2.rows[0]?.auto_commit) !== "1")
      return { status: "refused" };
    const doltTransactionCommit = await executeDoltSqlProgram(
      this.#writer,
      "SET @@SESSION.dolt_transaction_commit = 1; SELECT @@SESSION.dolt_transaction_commit AS dolt_transaction_commit"
    );
    if (doltTransactionCommit.status !== "ok" || doltTransactionCommit.results.at(-1)?.length !== 1 || String(
      doltTransactionCommit.results.at(-1)?.[0]?.dolt_transaction_commit
    ) !== "1")
      return { status: "refused" };
    const initialCommit = await this.#doltCommitEvidence();
    if (initialCommit.status !== "ok") return initialCommit;
    this.#autoCommitObserved = true;
    this.#doltTransactionCommitObserved = true;
    if (this.#worker === void 0) return { status: "refused" };
    const issues = quotedIdentifier(this.#identity.database);
    if (issues === void 0) return { status: "refused" };
    const workerRead = await executeDoltSqlRead(
      this.#worker,
      `SELECT id FROM ${issues}.issues LIMIT 1`
    );
    if (workerRead.status !== "ok") return { status: workerRead.status };
    const workerBinding = doltSqlTransportBinding(this.#worker);
    if (workerBinding === void 0) return { status: "refused" };
    const currentWorker = await executeDoltSqlRead(
      this.#worker,
      "SELECT CURRENT_USER() AS current_principal"
    );
    if (currentWorker.status !== "ok" || currentWorker.rows.length !== 1 || currentWorker.rows[0]?.current_principal !== `${workerBinding.user}@%`)
      return currentWorker.status === "ok" ? { status: "refused" } : currentWorker;
    const grants = await executeDoltSqlRead(
      this.#writer,
      `SHOW GRANTS FOR '${workerBinding.user}'@'%'`
    );
    if (grants.status !== "ok" || !exactWorkerSelectGrants(
      grants.rows,
      workerBinding.user,
      this.#identity.database
    ))
      return grants.status === "ok" ? { status: "refused" } : grants;
    const workerProbe = await probeDoltSqlWorkerWrite(this.#worker);
    if (workerProbe === "allowed") return { status: "refused" };
    if (workerProbe !== "denied")
      return {
        status: workerProbe === "unavailable" ? "unavailable" : "refused"
      };
    const probe = {
      status: "ok",
      value: {
        autoCommitPolicy: this.#identity.autoCommitPolicy,
        credentialReference: this.#identity.credentialReference,
        database: this.#identity.database,
        endpoint: this.#identity.endpoint,
        schema: this.#identity.schema,
        workerGrant: {
          credentialReference: this.#identity.workerCredentialReference,
          serverEnforced: true,
          writeDenied: true
        }
      }
    };
    this.#readyIdentity = expected;
    this.#ready = true;
    return probe;
  }
  async mergeSlotAcquire(input) {
    const slotInput = this.#slotInput(input, false);
    if (slotInput === void 0) return this.#invalidate({ status: "refused" });
    if (!this.#isReady() || this.#slotProcess === void 0)
      return { status: "refused" };
    const binding = await this.#slotProcess.matchesIdentity(this.#identity);
    if (binding.status !== "ok") {
      this.disarm();
      return binding;
    }
    const precheck = await this.#slotReadback(
      slotInput.prefix,
      slotInput.scope,
      slotInput.actor
    );
    if (precheck.status !== "ok") {
      this.disarm();
      return precheck;
    }
    const attempt = await this.#slotProcess.acquire(slotInput.actor);
    const result2 = await this.#slotAfterCommand("acquire", attempt, slotInput);
    if (result2.status !== "ok") this.disarm();
    return result2;
  }
  async mergeSlotCheck(input) {
    const slotInput = this.#slotInput(input, true);
    if (slotInput === void 0) return this.#invalidate({ status: "refused" });
    if (!this.#isReady() || this.#slotProcess === void 0)
      return { status: "refused" };
    const binding = await this.#slotProcess.matchesIdentity(this.#identity);
    if (binding.status !== "ok") {
      this.disarm();
      return binding;
    }
    const precheck = await this.#slotReadback(
      slotInput.prefix,
      slotInput.scope,
      slotInput.actor
    );
    if (precheck.status !== "ok") {
      this.disarm();
      return precheck;
    }
    const attempt = await this.#slotProcess.check(slotInput.actor);
    const result2 = await this.#slotAfterCommand("check", attempt, slotInput);
    if (result2.status !== "ok") this.disarm();
    return result2;
  }
  async mergeSlotRelease(input) {
    const slotInput = this.#slotInput(input, false);
    if (slotInput === void 0) return this.#invalidate({ status: "refused" });
    if (!this.#isReady() || this.#slotProcess === void 0)
      return { status: "refused" };
    const binding = await this.#slotProcess.matchesIdentity(this.#identity);
    if (binding.status !== "ok") {
      this.disarm();
      return binding;
    }
    const precheck = await this.#slotReadback(
      slotInput.prefix,
      slotInput.scope,
      slotInput.actor
    );
    if (precheck.status !== "ok" || precheck.value.observation.status !== "acquired" || precheck.value.observation.holder !== slotInput.actor)
      return precheck.status === "ok" ? this.#invalidate({ status: "refused" }) : this.#invalidate(precheck);
    const attempt = await this.#slotProcess.release(slotInput.actor);
    const result2 = await this.#slotAfterCommand("release", attempt, slotInput);
    if (result2.status !== "ok") this.disarm();
    return result2;
  }
  async initializeEnvelope(input) {
    const initialization = this.#initializationInput(input);
    if (initialization === void 0) {
      this.disarm();
      return { status: "refused" };
    }
    if (!this.#isReady() || initialization.authority !== "authorized_initialization")
      return { status: "refused" };
    if (this.#slotProcess === void 0) return { status: "refused" };
    const binding = await this.#slotProcess.matchesIdentity(this.#identity);
    if (binding.status !== "ok") {
      this.disarm();
      return binding;
    }
    const affected = await this.#mutateAffected(
      `UPDATE ${this.#issues()} SET metadata = JSON_SET(metadata, '$.sce', ${sqlJson(initialization.envelope)}) WHERE id = ${sqlLiteral(initialization.issueId)} AND JSON_EXTRACT(metadata, '$.sce') IS NULL`,
      1
    );
    if (affected.status !== "ok") {
      this.disarm();
      return { status: affected.status };
    }
    if (affected.rows === 0) return { status: "already_initialized" };
    return affected.rows === 1 ? { status: "initialized" } : { status: "refused" };
  }
  async mutate(input) {
    const mutation = this.#mutationInput(input);
    const batch = mutation === void 0 ? void 0 : normalizedMutationBatch(mutation.batch);
    if (mutation === void 0 || batch === void 0) {
      this.disarm();
      return { phase: "before_transaction", status: "refused" };
    }
    if (!this.#isReady(mutation.identity)) {
      this.disarm();
      return { phase: "before_transaction", status: "refused" };
    }
    if (this.#slotProcess === void 0)
      return { phase: "before_transaction", status: "refused" };
    const binding = await this.#slotProcess.matchesIdentity(this.#identity);
    if (binding.status !== "ok") {
      this.disarm();
      return { phase: "before_transaction", status: binding.status };
    }
    if (this.#identity.autoCommitPolicy !== "on" || !this.#autoCommitObserved || !this.#doltTransactionCommitObserved)
      return { phase: "before_transaction", status: "refused" };
    const statement = this.#casStatement(batch);
    if (statement === void 0)
      return { phase: "before_transaction", status: "refused" };
    const affected = await this.#mutateAffected(
      statement,
      batch.changedRows.length + 1
    );
    if (affected.status !== "ok") {
      this.disarm();
      return { phase: "commit_unknown", status: affected.status };
    }
    if (affected.rows === 0) {
      const afterStale = await this.#doltCommitEvidence();
      if (afterStale.status !== "ok") {
        this.disarm();
        return {
          phase: "commit_unknown",
          status: afterStale.status
        };
      }
      return {
        status: "ok",
        value: {
          commit: afterStale.value,
          result: { status: "stale" }
        }
      };
    }
    if (affected.rows !== batch.changedRows.length + 1) {
      this.disarm();
      return { phase: "commit_unknown", status: "ambiguous" };
    }
    if (affected.committedHead === void 0) {
      this.disarm();
      return { phase: "commit_unknown", status: "ambiguous" };
    }
    try {
      await doltBeadsServerDriverPostTransactionTestHook?.({
        committedHead: affected.committedHead
      });
    } catch {
      this.disarm();
      return { phase: "commit_unknown", status: "ambiguous" };
    }
    const readback = await this.#readback(batch);
    if (readback.status !== "ok") {
      this.disarm();
      return { phase: "commit_unknown", status: readback.status };
    }
    return {
      status: "ok",
      value: {
        // The transaction child observed this head and clean working set in
        // the very session that sent COMMIT. A later shared-server head may
        // legitimately advance because of unrelated writers, so it is not a
        // substitute for this commit witness.
        commit: {
          autoCommitPolicy: this.#identity.autoCommitPolicy,
          commit: "auto",
          head: affected.committedHead,
          workingSet: "clean"
        },
        result: {
          affectedRowCount: affected.rows,
          checkpoint: batch.checkpoint,
          children: batch.next.children,
          root: batch.next.root,
          status: "applied"
        }
      }
    };
  }
  async preOwnershipMutate(input) {
    const parsed = this.#preOwnershipInput(input);
    const plan = parsed === void 0 ? void 0 : this.#preOwnershipPlan(parsed.mutation);
    if (parsed === void 0 || plan === void 0) {
      this.disarm();
      return { phase: "before_transaction", status: "refused" };
    }
    if (!this.#isReady(parsed.identity)) {
      this.disarm();
      return { phase: "before_transaction", status: "refused" };
    }
    if (this.#slotProcess === void 0)
      return { phase: "before_transaction", status: "refused" };
    const binding = await this.#slotProcess.matchesIdentity(this.#identity);
    if (binding.status !== "ok") {
      this.disarm();
      return { phase: "before_transaction", status: binding.status };
    }
    if (this.#identity.autoCommitPolicy !== "on" || !this.#autoCommitObserved || !this.#doltTransactionCommitObserved)
      return { phase: "before_transaction", status: "refused" };
    const affected = await this.#mutateAffected(
      plan.statement,
      plan.expectedRows
    );
    if (affected.status !== "ok") {
      this.disarm();
      return { phase: "commit_unknown", status: affected.status };
    }
    if (affected.rows === 0) {
      const afterStale = await this.#doltCommitEvidence();
      if (afterStale.status !== "ok") {
        this.disarm();
        return { phase: "commit_unknown", status: afterStale.status };
      }
      return {
        status: "ok",
        value: {
          commit: afterStale.value,
          result: { status: "stale" }
        }
      };
    }
    if (affected.rows !== plan.expectedRows || affected.committedHead === void 0) {
      this.disarm();
      return { phase: "commit_unknown", status: "ambiguous" };
    }
    try {
      await doltBeadsServerDriverPostTransactionTestHook?.({
        committedHead: affected.committedHead
      });
    } catch {
      this.disarm();
      return { phase: "commit_unknown", status: "ambiguous" };
    }
    const readback = await this.#readbackNext(plan.next);
    if (readback.status !== "ok") {
      this.disarm();
      return { phase: "commit_unknown", status: readback.status };
    }
    return {
      status: "ok",
      value: {
        commit: {
          autoCommitPolicy: this.#identity.autoCommitPolicy,
          commit: "auto",
          head: affected.committedHead,
          workingSet: "clean"
        },
        result: {
          affectedRowCount: affected.rows,
          checkpoint: plan.checkpoint,
          children: plan.next.children,
          root: plan.next.root,
          status: "applied"
        }
      }
    };
  }
  async discover(input) {
    const discovery = this.#discoveryInput(input);
    if (discovery === void 0 || discovery.prefix !== this.#identity.prefix || !exact(discovery.identity, this.#identity))
      return this.#invalidate({ status: "refused" });
    const liveBinding = await this.#liveDiscoveryBinding();
    if (liveBinding.status !== "ok") return this.#invalidate(liveBinding);
    const slot = await this.#slotReadback(discovery.prefix, discovery.scope);
    if (slot.status !== "ok") return this.#invalidate(slot);
    const metadata = await this.#metadata([
      this.#rows.rootBeadId,
      ...Object.values(this.#rows.childBeadIds)
    ]);
    if (metadata.status !== "ok")
      return this.#invalidate({ status: metadata.status });
    const configuredIds = [
      this.#rows.rootBeadId,
      ...Object.values(this.#rows.childBeadIds)
    ];
    const presence = configuredIds.map(
      (id) => Object.prototype.hasOwnProperty.call(metadata.value.get(id) ?? {}, "sce")
    );
    if (presence.every((present) => !present))
      return slot.value.observation.status === "available" ? {
        status: "ok",
        value: { status: "absent", slot: slot.value.observation }
      } : this.#invalidate({ status: "refused" });
    if (presence.some((present) => !present))
      return this.#invalidate({ status: "refused" });
    const root = metadata.value.get(this.#rows.rootBeadId)?.sce;
    const parsedRoot = validateRootProjection(root);
    if (!parsedRoot.ok) return this.#invalidate({ status: "refused" });
    const children = Object.values(this.#rows.childBeadIds).map(
      (id) => metadata.value.get(id)?.sce
    );
    if (children.length !== parsedRoot.value.childRows.length || children.some((child) => !validateChildProjection(child).ok))
      return this.#invalidate({ status: "refused" });
    return {
      status: "ok",
      value: {
        checkpoint: parsedRoot.value.checkpoint,
        children,
        root: parsedRoot.value,
        slot: slot.value.observation
      }
    };
  }
  async #doltCommitEvidence() {
    const status = await executeDoltSqlRead(
      this.#writer,
      "SELECT * FROM dolt_status"
    );
    if (status.status !== "ok") return status;
    if (status.rows.length !== 0) return { status: "refused" };
    const head3 = await executeDoltSqlRead(
      this.#writer,
      "SELECT DOLT_HASHOF('HEAD') AS head"
    );
    const value = head3.status === "ok" ? head3.rows[0]?.head : void 0;
    if (head3.status !== "ok" || head3.rows.length !== 1 || typeof value !== "string" || !/^[0-9a-z]{20,64}$/u.test(value))
      return head3.status === "ok" ? { status: "refused" } : head3;
    return {
      status: "ok",
      value: {
        autoCommitPolicy: this.#identity.autoCommitPolicy,
        commit: "auto",
        head: value,
        workingSet: "clean"
      }
    };
  }
  #transportsMatchIdentity() {
    const writer = doltSqlTransportBinding(this.#writer);
    const worker = this.#worker === void 0 ? void 0 : doltSqlTransportBinding(this.#worker);
    return writer !== void 0 && worker !== void 0 && exact(writer.identity, this.#identity) && exact(worker.identity, this.#identity) && writer.role === "writer" && worker.role === "worker" && writer.credentialReference === this.#identity.credentialReference && worker.credentialReference === this.#identity.workerCredentialReference;
  }
  /**
   * A non-mutating identity proof shared by preflight and fault
   * reconciliation. The public driver can be called directly, so discovery
   * cannot trust a caller-supplied identity or a formerly-ready flag: it must
   * bind the exact configured transports to the live server and pinned bd
   * workspace each time before it reads an authoritative row.
   */
  async #liveDiscoveryBinding() {
    if (this.#identity.autoCommitPolicy !== "on" || !this.#transportsMatchIdentity() || this.#slotProcess === void 0)
      return { status: "refused" };
    const slotBinding = await this.#slotProcess.matchesIdentity(this.#identity);
    if (slotBinding.status !== "ok") return slotBinding;
    const database = await executeDoltSqlRead(
      this.#writer,
      "SELECT DATABASE() AS current_database"
    );
    if (database.status !== "ok") return { status: database.status };
    if (database.rows.length !== 1 || database.rows[0]?.current_database !== this.#identity.database)
      return { status: "refused" };
    const serverVersion = await executeDoltSqlRead(
      this.#writer,
      "SELECT DOLT_VERSION() AS dolt_version"
    );
    if (serverVersion.status !== "ok" || serverVersion.rows.length !== 1 || serverVersion.rows[0]?.dolt_version !== "2.2.1")
      return serverVersion.status === "ok" ? { status: "refused" } : serverVersion;
    const writer = doltSqlTransportBinding(this.#writer);
    if (writer === void 0 || writer.role !== "writer")
      return { status: "refused" };
    const currentWriter = await executeDoltSqlRead(
      this.#writer,
      "SELECT CURRENT_USER() AS current_principal"
    );
    if (currentWriter.status !== "ok" || currentWriter.rows.length !== 1 || currentWriter.rows[0]?.current_principal !== `${writer.user}@%`)
      return currentWriter.status === "ok" ? { status: "refused" } : currentWriter;
    return { status: "ok", value: void 0 };
  }
  #isReady(identity2 = this.#identity) {
    if (identity2 === void 0) return false;
    try {
      return this.#ready && this.#readyIdentity !== void 0 && exact(identity2, this.#identity) && exact(this.#readyIdentity, this.#identity);
    } catch {
      return false;
    }
  }
  #slotInput(input, actorOptional) {
    const value = actorOptional ? safeOptionalRecord(input, ["prefix", "scope"], ["actor"]) : safeRecord(input, ["actor", "prefix", "scope"]);
    if (value === void 0 || typeof value.prefix !== "string")
      return void 0;
    const actor = value.actor ?? (actorOptional ? "slot-observer" : void 0);
    const scope = normalizedScope(value.scope);
    return value.prefix === this.#identity.prefix && typeof actor === "string" && validIdentifier(actor) && scope !== void 0 ? { actor, prefix: value.prefix, scope } : void 0;
  }
  #initializationInput(input) {
    const value = safeRecord(input, ["authority", "envelope", "issueId"]);
    const envelope = value === void 0 ? void 0 : normalizedJsonValue(value.envelope);
    try {
      return value?.authority === "authorized_initialization" && typeof value.issueId === "string" && validIdentifier(value.issueId) && envelope !== void 0 && !containsSecretShape(envelope) ? {
        authority: value.authority,
        envelope,
        issueId: value.issueId
      } : void 0;
    } catch {
      return void 0;
    }
  }
  #mutationInput(input) {
    const value = safeRecord(input, ["batch", "identity"]);
    const identity2 = value === void 0 ? void 0 : normalizedServerIdentity(value.identity);
    return value !== void 0 && identity2 !== void 0 ? { batch: value.batch, identity: identity2 } : void 0;
  }
  #preOwnershipInput(input) {
    const value = safeRecord(input, ["identity", "mutation"]);
    const identity2 = value === void 0 ? void 0 : normalizedServerIdentity(value.identity);
    return value !== void 0 && identity2 !== void 0 ? { identity: identity2, mutation: value.mutation } : void 0;
  }
  #discoveryInput(input) {
    const value = safeRecord(input, ["identity", "prefix", "scope"]);
    const identity2 = value === void 0 ? void 0 : normalizedServerIdentity(value.identity);
    const scope = value === void 0 ? void 0 : normalizedScope(value.scope);
    return value !== void 0 && identity2 !== void 0 && typeof value.prefix === "string" && scope !== void 0 ? { identity: identity2, prefix: value.prefix, scope } : void 0;
  }
  #invalidate(value) {
    this.disarm();
    return value;
  }
  #issues() {
    const database = quotedIdentifier(this.#identity.database);
    if (database === void 0) throw new Error("invalid server database");
    return `${database}.issues`;
  }
  #labels() {
    const database = quotedIdentifier(this.#identity.database);
    if (database === void 0) throw new Error("invalid server database");
    return `${database}.labels`;
  }
  #slotDesign(prefix, scope) {
    const slotId2 = sqlLiteral(`${prefix}-merge-slot`);
    return `id = ${slotId2} AND external_ref = ${sqlLiteral(slotScopeReference(scope))} AND design = ${sqlLiteral(canonicalJson(scope))} AND title = 'Merge Slot' AND (SELECT COUNT(*) FROM ${this.#labels()} WHERE issue_id = ${slotId2}) = 1 AND EXISTS (SELECT 1 FROM ${this.#labels()} WHERE issue_id = ${slotId2} AND label = 'gt:slot')`;
  }
  #slot(status, holder4, actor, scope) {
    if (!validIdentifier(actor)) return void 0;
    const withoutHash = {
      actor,
      ...holder4 === void 0 ? {} : { holder: holder4 },
      label: "gt:slot",
      scope,
      scopeCommitment: deriveScopeCommitment(scope),
      slotId: `${this.#identity.prefix}-merge-slot`,
      status,
      title: "Merge Slot",
      version: 1
    };
    return {
      ...withoutHash,
      readbackHash: deriveSlotReadbackHash(withoutHash)
    };
  }
  async #slotAfterCommand(command, attempt, input) {
    if (attempt.status === "unavailable" || attempt.status === "refused")
      return attempt;
    if (attempt.status === "ambiguous") return { status: "ambiguous" };
    const readback = await this.#slotReadback(
      input.prefix,
      input.scope,
      input.actor
    );
    if (readback.status !== "ok") return readback;
    const observation = readback.value.observation;
    if (attempt.status === "rejected") {
      return command === "acquire" && observation.status === "acquired" && observation.holder !== input.actor ? readback : { status: "ambiguous" };
    }
    if (command === "acquire" && (observation.status !== "acquired" || observation.holder !== input.actor) || command === "release" && observation.status !== "available")
      return { status: "ambiguous" };
    return readback;
  }
  async #slotReadback(prefix, scope, actor = "slot-observer/0") {
    if (prefix !== this.#identity.prefix || !isSchema(FencingScopeSchema, scope) || !validIdentifier(actor))
      return { status: "refused" };
    const result2 = await executeDoltSqlRead(
      this.#writer,
      `SELECT status, metadata, external_ref, title, design FROM ${this.#issues()} WHERE id = ${sqlLiteral(`${prefix}-merge-slot`)}`
    );
    if (result2.status !== "ok") return { status: result2.status };
    if (result2.rows.length !== 1 || result2.rows[0]?.external_ref !== slotScopeReference(scope) || result2.rows[0]?.title !== "Merge Slot" || result2.rows[0]?.design !== canonicalJson(scope))
      return { status: "refused" };
    const labels = await executeDoltSqlRead(
      this.#writer,
      `SELECT label FROM ${this.#labels()} WHERE issue_id = ${sqlLiteral(`${prefix}-merge-slot`)}`
    );
    if (labels.status !== "ok") return { status: labels.status };
    if (labels.rows.length !== 1 || labels.rows[0]?.label !== "gt:slot")
      return { status: "refused" };
    const metadata = jsonRecord(result2.rows[0]?.metadata);
    const metadataKeys = metadata === void 0 ? [] : Object.keys(metadata).sort();
    const holder4 = metadata?.holder;
    const acquired = result2.rows[0]?.status === "in_progress";
    if (result2.rows[0]?.status !== "open" && !acquired || acquired && typeof holder4 !== "string" || !acquired && holder4 !== void 0 || acquired && metadataKeys.join(",") !== "holder" || !acquired && metadataKeys.length !== 0)
      return { status: "refused" };
    const observation = this.#slot(
      acquired ? "acquired" : "available",
      acquired && typeof holder4 === "string" ? holder4 : void 0,
      acquired && typeof holder4 === "string" ? holder4 : actor,
      scope
    );
    const parsed = validateMergeSlotObservation(observation, prefix, scope);
    return parsed.ok ? {
      status: "ok",
      value: {
        observation: parsed.value,
        scopeReference: slotScopeReference(scope)
      }
    } : { status: "refused" };
  }
  async #mutateAffected(statement, expectedRows) {
    const response = await executeDoltSqlTransaction(
      this.#writer,
      statement,
      expectedRows
    );
    if (response.status !== "ok") return response;
    return {
      status: "ok",
      rows: response.rows,
      ...response.committedHead === void 0 ? {} : { committedHead: response.committedHead }
    };
  }
  async #metadata(ids) {
    if (ids.length === 0 || ids.some((id) => !validIdentifier(id)))
      return { status: "refused" };
    const result2 = await executeDoltSqlRead(
      this.#writer,
      `SELECT id, JSON_UNQUOTE(JSON_EXTRACT(metadata, '$')) AS metadata FROM ${this.#issues()} WHERE id IN (${ids.map(sqlLiteral).join(",")}) ORDER BY id`
    );
    if (result2.status !== "ok") return { status: result2.status };
    if (result2.rows.length !== ids.length) return { status: "refused" };
    const value = /* @__PURE__ */ new Map();
    for (const row of result2.rows) {
      if (typeof row.id !== "string") return { status: "refused" };
      const metadata = jsonRecord(row.metadata);
      if (metadata === void 0 || value.has(row.id))
        return { status: "refused" };
      value.set(row.id, metadata);
    }
    return { status: "ok", value };
  }
  async #readback(batch) {
    return await this.#readbackNext(batch.next);
  }
  async #readbackNext(next) {
    const metadata = await this.#metadata([
      this.#rows.rootBeadId,
      ...next.children.map((child) => this.#rows.childBeadIds[child.unitId])
    ]);
    if (metadata.status !== "ok") return { status: metadata.status };
    const root = metadata.value.get(this.#rows.rootBeadId)?.sce;
    const children = next.children.map(
      (child) => metadata.value.get(this.#rows.childBeadIds[child.unitId])?.sce
    );
    return exact(root, next.root) && exact(children, next.children) ? { status: "ok" } : { status: "ambiguous" };
  }
  #preOwnershipPlan(input) {
    const existing = safeRecord(input, ["batch", "kind"]);
    if (existing?.kind === "existing") {
      const batch = normalizedMutationBatch(existing.batch);
      if (batch === void 0) return void 0;
      const run2 = batch.next.root.run;
      const transition2 = run2.effectJournal.at(-1)?.slotTransition;
      if (run2.state !== "initializing" || run2.controller.state !== "acquire_intent" || run2.controller.holder !== batch.expectedHolder || batch.holder !== batch.expectedHolder || !exact(batch.scope, batch.next.root.scope) || run2.effectJournal.at(-1)?.kind !== "controller_acquire" || run2.effectJournal.at(-1)?.status !== "intended" || !validateServerSlotTransitionIntent(
        transition2,
        this.#identity.prefix,
        batch.scope,
        batch.expectedHolder,
        "acquire"
      ))
        return void 0;
      const statement2 = this.#preOwnershipExistingStatement(batch);
      return statement2 === void 0 ? void 0 : {
        checkpoint: batch.checkpoint,
        expectedRows: batch.changedRows.length + 1,
        next: batch.next,
        statement: statement2
      };
    }
    const initialRecord = safeRecord(input, ["initial", "kind"]);
    if (initialRecord?.kind !== "initial") return void 0;
    const parsed = validate(
      InitialControllerAcquireSchema,
      initialRecord.initial
    );
    if (!parsed.ok || parsed.value === void 0) return void 0;
    const initial = parsed.value;
    const root = validateRootProjection(initial.next.root);
    const configuredUnits = Object.keys(this.#rows.childBeadIds).sort();
    const childUnits = initial.next.children.map((child) => child.unitId).sort();
    const transition = initial.next.root.run.effectJournal[0]?.slotTransition;
    if (!root.ok || !exact(configuredUnits, childUnits) || !exact(
      configuredUnits,
      initial.next.root.childRows.map((row) => row.unitId).sort()
    ) || initial.expected.holder !== initial.next.root.holder || !exact(initial.expected.scope, initial.next.root.scope) || initial.next.root.run.revision !== 1 || initial.next.root.run.state !== "initializing" || initial.next.root.run.controller.state !== "acquire_intent" || initial.next.root.run.controller.holder !== initial.expected.holder || initial.next.root.run.effectJournal.length !== 1 || initial.next.root.run.effectJournal[0]?.kind !== "controller_acquire" || initial.next.root.run.effectJournal[0]?.status !== "intended" || !validateServerSlotTransitionIntent(
      transition,
      this.#identity.prefix,
      initial.expected.scope,
      initial.expected.holder,
      "acquire"
    ) || initial.next.children.some((child) => {
      const parsedChild = validateChildProjection(child);
      const reference = initial.next.root.childRows.find(
        (row) => row.unitId === child.unitId
      );
      return !parsedChild.ok || reference?.revision !== child.revision || reference.commitment !== child.commitment || child.holder !== initial.expected.holder || !exact(child.scope, initial.expected.scope);
    }))
      return void 0;
    const statement = this.#preOwnershipInitialStatement(initial);
    return statement === void 0 ? void 0 : {
      checkpoint: initial.next.root.checkpoint,
      expectedRows: initial.next.children.length + 1,
      next: initial.next,
      statement
    };
  }
  #preOwnershipExistingStatement(batch) {
    const children = batch.next.children.map((child) => {
      const expected = batch.expectedChildren.find(
        (value) => value.unitId === child.unitId
      );
      const id = this.#rows.childBeadIds[child.unitId];
      return expected === void 0 || id === void 0 || !validIdentifier(id) ? void 0 : { child, expected, id };
    });
    if (children.some((child) => child === void 0)) return void 0;
    const mapped = children;
    const ids = [this.#rows.rootBeadId, ...mapped.map((child) => child.id)];
    if (new Set(ids).size !== ids.length) return void 0;
    const scope = sqlJson(batch.scope);
    const eligibility = [
      `${this.#slotDesign(this.#identity.prefix, batch.scope)} AND status = 'open' AND JSON_LENGTH(metadata) = 0`,
      `id = ${sqlLiteral(this.#rows.rootBeadId)} AND JSON_EXTRACT(metadata, '$.sce') IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.aggregateRevision')) = ${sqlLiteral(batch.expectedAggregateRevision)} AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.aggregateCommitment')) = ${sqlLiteral(batch.expectedAggregateCommitment)} AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.holder')) = ${sqlLiteral(batch.expectedHolder)} AND JSON_EXTRACT(metadata, '$.sce.scope') = ${scope}`,
      ...mapped.map(
        ({ expected, id }) => `id = ${sqlLiteral(id)} AND JSON_EXTRACT(metadata, '$.sce') IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.revision')) = ${sqlLiteral(expected.expectedRevision)} AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.commitment')) = ${sqlLiteral(expected.expectedCommitment)} AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.holder')) = ${sqlLiteral(batch.expectedHolder)} AND JSON_EXTRACT(metadata, '$.sce.scope') = ${scope}`
      )
    ];
    const cases = [
      `WHEN ${sqlLiteral(this.#rows.rootBeadId)} THEN JSON_SET(target.metadata, '$.sce', ${sqlJson(batch.next.root)})`,
      ...mapped.map(
        ({ child, id }) => `WHEN ${sqlLiteral(id)} THEN JSON_SET(target.metadata, '$.sce', ${sqlJson(child)})`
      )
    ];
    return `UPDATE ${this.#issues()} AS target JOIN (SELECT COUNT(*) AS eligible FROM ${this.#issues()} WHERE ${eligibility.map((item) => `(${item})`).join(" OR ")}) AS gate SET target.metadata = CASE target.id ${cases.join(" ")} ELSE target.metadata END WHERE target.id IN (${ids.map(sqlLiteral).join(",")}) AND gate.eligible = ${ids.length + 1}`;
  }
  #preOwnershipInitialStatement(initial) {
    const children = initial.next.children.map((child) => {
      const id = this.#rows.childBeadIds[child.unitId];
      return id === void 0 || !validIdentifier(id) ? void 0 : { child, id };
    });
    if (children.some((child) => child === void 0)) return void 0;
    const mapped = children;
    const ids = [this.#rows.rootBeadId, ...mapped.map((child) => child.id)];
    if (new Set(ids).size !== ids.length) return void 0;
    const eligibility = [
      `${this.#slotDesign(this.#identity.prefix, initial.expected.scope)} AND status = 'open' AND JSON_LENGTH(metadata) = 0`,
      ...ids.map(
        (id) => `id = ${sqlLiteral(id)} AND JSON_EXTRACT(metadata, '$.sce') IS NULL`
      )
    ];
    const cases = [
      `WHEN ${sqlLiteral(this.#rows.rootBeadId)} THEN JSON_SET(target.metadata, '$.sce', ${sqlJson(initial.next.root)})`,
      ...mapped.map(
        ({ child, id }) => `WHEN ${sqlLiteral(id)} THEN JSON_SET(target.metadata, '$.sce', ${sqlJson(child)})`
      )
    ];
    return `UPDATE ${this.#issues()} AS target JOIN (SELECT COUNT(*) AS eligible FROM ${this.#issues()} WHERE ${eligibility.map((item) => `(${item})`).join(" OR ")}) AS gate SET target.metadata = CASE target.id ${cases.join(" ")} ELSE target.metadata END WHERE target.id IN (${ids.map(sqlLiteral).join(",")}) AND gate.eligible = ${ids.length + 1}`;
  }
  #casStatement(batch) {
    const children = batch.next.children.map((child) => {
      const expected = batch.expectedChildren.find(
        (value) => value.unitId === child.unitId
      );
      const id = this.#rows.childBeadIds[child.unitId];
      return expected === void 0 || id === void 0 || !validIdentifier(id) ? void 0 : { child, expected, id };
    });
    if (children.some((child) => child === void 0)) return void 0;
    const mapped = children;
    const ids = [this.#rows.rootBeadId, ...mapped.map((child) => child.id)];
    if (new Set(ids).size !== ids.length) return void 0;
    const scope = sqlJson(batch.scope);
    const eligibility = [
      `${this.#slotDesign(this.#identity.prefix, batch.scope)} AND status = 'in_progress' AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.holder')) = ${sqlLiteral(batch.expectedHolder)}`,
      `id = ${sqlLiteral(this.#rows.rootBeadId)} AND JSON_EXTRACT(metadata, '$.sce') IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.aggregateRevision')) = ${sqlLiteral(batch.expectedAggregateRevision)} AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.aggregateCommitment')) = ${sqlLiteral(batch.expectedAggregateCommitment)} AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.holder')) = ${sqlLiteral(batch.expectedHolder)} AND JSON_EXTRACT(metadata, '$.sce.scope') = ${scope}`,
      ...mapped.map(
        ({ expected, id }) => `id = ${sqlLiteral(id)} AND JSON_EXTRACT(metadata, '$.sce') IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.revision')) = ${sqlLiteral(expected.expectedRevision)} AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.commitment')) = ${sqlLiteral(expected.expectedCommitment)} AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.holder')) = ${sqlLiteral(batch.expectedHolder)} AND JSON_EXTRACT(metadata, '$.sce.scope') = ${scope}`
      )
    ];
    const cases = [
      `WHEN ${sqlLiteral(this.#rows.rootBeadId)} THEN JSON_SET(target.metadata, '$.sce', ${sqlJson(batch.next.root)})`,
      ...mapped.map(
        ({ child, id }) => `WHEN ${sqlLiteral(id)} THEN JSON_SET(target.metadata, '$.sce', ${sqlJson(child)})`
      )
    ];
    return `UPDATE ${this.#issues()} AS target JOIN (SELECT COUNT(*) AS eligible FROM ${this.#issues()} WHERE ${eligibility.map((item) => `(${item})`).join(" OR ")}) AS gate SET target.metadata = CASE target.id ${cases.join(" ")} ELSE target.metadata END WHERE target.id IN (${ids.map(sqlLiteral).join(",")}) AND gate.eligible = ${ids.length + 1}`;
  }
};

// src/controller-config.ts
var MAX_CONFIG_BYTES = 256 * 1024;
var ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]{0,159}$/u;
var SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
function record(input, keys) {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    return void 0;
  const value = input;
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",") ? value : void 0;
}
function text3(value, limit = 4096) {
  return typeof value === "string" && value.length > 0 && value.length <= limit && !value.includes("\0") ? value : void 0;
}
function absolutePath2(value) {
  const path2 = text3(value);
  if (path2 === void 0 || !isAbsolute6(path2)) return void 0;
  const canonical2 = normalize3(resolve3(path2));
  return canonical2 === "/" ? void 0 : canonical2;
}
function identifier4(value) {
  const candidate = text3(value, 160);
  return candidate !== void 0 && SAFE_IDENTIFIER.test(candidate) ? candidate : void 0;
}
function environmentName(value) {
  const candidate = text3(value, 160);
  return candidate !== void 0 && ENVIRONMENT_NAME.test(candidate) ? candidate : void 0;
}
function childRows2(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return void 0;
  const entries = Object.entries(value);
  if (entries.length > 64 || entries.some(
    ([unit, row]) => identifier4(unit) === void 0 || identifier4(row) === void 0
  ))
    return void 0;
  return Object.freeze(Object.fromEntries(entries));
}
function embeddedTopology(value) {
  const base = record(value, [
    "bdExecutable",
    "childBeadIds",
    "databaseDirectory",
    "doltExecutable",
    "kind",
    "mode",
    "prefix",
    "preflight",
    "remote",
    "rootBeadId"
  ]);
  const noRemote = record(value, [
    "bdExecutable",
    "childBeadIds",
    "databaseDirectory",
    "doltExecutable",
    "kind",
    "mode",
    "prefix",
    "preflight",
    "rootBeadId"
  ]);
  const item = base ?? noRemote;
  if (item === void 0 || item.kind !== "embedded" || item.mode !== "local-only" && item.mode !== "git-sync" || !isSchema(PreflightEnvelopeSchema, item.preflight))
    return void 0;
  const remote2 = item.remote;
  const parsedRemote = remote2 === void 0 ? void 0 : record(remote2, ["name", "ref", "url"]);
  if (item.mode === "git-sync" && parsedRemote === void 0 || item.mode === "local-only" && parsedRemote !== void 0)
    return void 0;
  const bdExecutable = absolutePath2(item.bdExecutable);
  const doltExecutable = absolutePath2(item.doltExecutable);
  const databaseDirectory = absolutePath2(item.databaseDirectory);
  const rootBeadId = identifier4(item.rootBeadId);
  const prefix = identifier4(item.prefix);
  const mapped = childRows2(item.childBeadIds);
  const preflight = item.preflight;
  if (bdExecutable === void 0 || doltExecutable === void 0 || databaseDirectory === void 0 || rootBeadId === void 0 || prefix === void 0 || mapped === void 0 || preflight.payload.status !== "ready" || preflight.payload.beads.mode !== "embedded" || preflight.payload.beads.prefix !== prefix || parsedRemote !== void 0 && (identifier4(parsedRemote.name) === void 0 || parsedRemote.ref !== "refs/dolt/data" || text3(parsedRemote.url, 1024) === void 0))
    return void 0;
  return {
    bdExecutable,
    childBeadIds: mapped,
    databaseDirectory,
    doltExecutable,
    kind: "embedded",
    mode: item.mode,
    prefix,
    preflight,
    ...parsedRemote === void 0 ? {} : {
      remote: {
        name: parsedRemote.name,
        ref: parsedRemote.ref,
        url: parsedRemote.url
      }
    },
    rootBeadId
  };
}
function sharedServerTopology(value) {
  const external = record(value, [
    "bdExecutable",
    "doltExecutable",
    "identity",
    "kind",
    "rows",
    "workerEnvironment",
    "workerUser",
    "workspace",
    "writerEnvironment",
    "writerUser"
  ]);
  const managed = record(value, [
    "bdExecutable",
    "dataDirectory",
    "doltExecutable",
    "identity",
    "kind",
    "rows",
    "runtimeConfigHome",
    "runtimeHome",
    "workerEnvironment",
    "workerUser",
    "workspace",
    "writerEnvironment",
    "writerUser"
  ]);
  const item = external ?? managed;
  if (item === void 0 || item.kind !== "shared-server") return void 0;
  const rows = record(item.rows, ["childBeadIds", "rootBeadId"]);
  const identity2 = item.identity;
  if (rows === void 0 || identity2 === null || typeof identity2 !== "object" || Array.isArray(identity2))
    return void 0;
  const bdExecutable = absolutePath2(item.bdExecutable);
  const doltExecutable = absolutePath2(item.doltExecutable);
  const workspace = absolutePath2(item.workspace);
  const rootBeadId = identifier4(rows.rootBeadId);
  const mapped = childRows2(rows.childBeadIds);
  const writerEnvironment = environmentName(item.writerEnvironment);
  const workerEnvironment = environmentName(item.workerEnvironment);
  const writerUser = identifier4(item.writerUser);
  const workerUser = identifier4(item.workerUser);
  const server = parseServerIdentity(identity2);
  if (bdExecutable === void 0 || doltExecutable === void 0 || workspace === void 0 || rootBeadId === void 0 || mapped === void 0 || writerEnvironment === void 0 || workerEnvironment === void 0 || writerEnvironment === workerEnvironment || writerUser === void 0 || workerUser === void 0 || server === void 0)
    return void 0;
  if (external !== void 0) {
    if (server.topology !== "external_server") return void 0;
    return {
      bdExecutable,
      doltExecutable,
      identity: server,
      kind: "shared-server",
      managed: false,
      rows: { childBeadIds: mapped, rootBeadId },
      workerEnvironment,
      workerUser,
      workspace,
      writerEnvironment,
      writerUser
    };
  }
  const dataDirectory = absolutePath2(managed?.dataDirectory);
  const runtimeHome = absolutePath2(managed?.runtimeHome);
  const runtimeConfigHome = absolutePath2(managed?.runtimeConfigHome);
  if (server.topology !== "managed_local_shared_server" || server.credentialProvenance !== "managed_local_runtime" || dataDirectory === void 0 || runtimeHome === void 0 || runtimeConfigHome === void 0)
    return void 0;
  return {
    bdExecutable,
    dataDirectory,
    doltExecutable,
    identity: server,
    kind: "shared-server",
    managed: true,
    rows: { childBeadIds: mapped, rootBeadId },
    runtimeConfigHome,
    runtimeHome,
    workerEnvironment,
    workerUser,
    workspace,
    writerEnvironment,
    writerUser
  };
}
function parseServerIdentity(value) {
  const item = record(value, [
    "autoCommitPolicy",
    "credentialProvenance",
    "credentialReference",
    "database",
    "endpoint",
    "prefix",
    "schema",
    "topology",
    "transportSecurity",
    "workerCredentialReference"
  ]);
  if (item === void 0) return void 0;
  const autoCommitPolicy = item.autoCommitPolicy;
  const credentialProvenance = item.credentialProvenance;
  const topology = item.topology;
  const transportSecurity = item.transportSecurity;
  if (autoCommitPolicy !== "on" && autoCommitPolicy !== "off" && autoCommitPolicy !== "batch" || credentialProvenance !== "environment" && credentialProvenance !== "managed_local_runtime" || topology !== "external_server" && topology !== "managed_local_shared_server" || transportSecurity !== "tls" && transportSecurity !== "loopback_plaintext")
    return void 0;
  const credentialReference = identifier4(item.credentialReference);
  const workerCredentialReference = identifier4(item.workerCredentialReference);
  const database = identifier4(item.database);
  const prefix = identifier4(item.prefix);
  const schema = identifier4(item.schema);
  const endpoint = text3(item.endpoint, 320);
  if (credentialReference === void 0 || workerCredentialReference === void 0 || credentialReference === workerCredentialReference || database === void 0 || prefix === void 0 || schema === void 0 || endpoint === void 0)
    return void 0;
  return {
    autoCommitPolicy,
    credentialProvenance,
    credentialReference,
    database,
    endpoint,
    prefix,
    schema,
    topology,
    transportSecurity,
    workerCredentialReference
  };
}
function parseControllerConfig(input) {
  if (containsSecretShape(input)) return void 0;
  const value = record(input, [
    "git",
    "initialRun",
    "nonce",
    "schema",
    "scope",
    "topology",
    "version"
  ]);
  if (value === void 0 || value.schema !== "sce.controller-config" || value.version !== 1 || !isSchema(RepositoryRunSchema, value.initialRun) || !isSchema(FencingScopeSchema, value.scope))
    return void 0;
  const git = record(value.git, ["remote", "repository"]) ?? record(value.git, ["repository"]);
  if (git === void 0 || !isSchema2(GitRepositorySchema, git.repository))
    return void 0;
  const nonce = identifier4(value.nonce);
  const remote2 = git.remote === void 0 ? void 0 : identifier4(git.remote);
  const topology = embeddedTopology(value.topology) ?? sharedServerTopology(value.topology);
  const run2 = value.initialRun;
  const scope = value.scope;
  const repository = git.repository;
  if (nonce === void 0 || git.remote !== void 0 && remote2 === void 0 || topology === void 0 || canonicalGitCommonDir(repository.commonDir) !== repository.commonDir || absolutePath2(repository.cwd) !== repository.cwd || run2.controller.holder.length === 0 || run2.repositoryIdentity !== repository.identity || run2.repositoryIdentity !== scope.gitRepositoryIdentity || run2.storeIdentity !== scope.beadsStoreIdentity || run2.integrationBranch !== scope.integrationBranch)
    return void 0;
  if (topology.kind === "embedded" && (topology.preflight.payload.status !== "ready" || topology.preflight.payload.git.commonDir !== repository.commonDir || topology.preflight.payload.git.identity !== repository.identity || topology.preflight.payload.git.objectFormat !== repository.objectFormat))
    return void 0;
  return {
    git: { repository, ...remote2 === void 0 ? {} : { remote: remote2 } },
    initialRun: run2,
    nonce,
    scope,
    schema: "sce.controller-config",
    topology,
    version: 1
  };
}
async function topologyProof(config) {
  const commonDir = canonicalGitCommonDir(config.git.repository.commonDir);
  if (commonDir === void 0 || commonDir !== config.git.repository.commonDir)
    return void 0;
  const verified = await verifyRepository(nodeGitRunner, config.git.repository);
  if (verified.state !== "observed") return void 0;
  return {
    commonDir,
    holder: config.initialRun.controller.holder,
    scope: config.scope
  };
}
function runtimeEnvironment(topology) {
  return () => ({
    HOME: topology.runtimeHome,
    XDG_CONFIG_HOME: topology.runtimeConfigHome
  });
}
async function embeddedTopologyProof(config, process2) {
  try {
    const state = await process2.execute({ kind: "state" });
    return state.kind === "state" && state.value.reachable ? await topologyProof(config) : void 0;
  } catch {
    return void 0;
  }
}
function embeddedRunner(config, topology) {
  const projections = new DoltProjectionPersistence({
    childIssueId: (unitId) => topology.childBeadIds[unitId],
    databaseDirectory: topology.databaseDirectory,
    doltExecutable: topology.doltExecutable,
    rootIssueId: topology.rootBeadId
  });
  const process2 = new PinnedBdEmbeddedProcess({
    bdExecutable: topology.bdExecutable,
    cwd: config.git.repository.cwd,
    databaseDirectory: topology.databaseDirectory,
    doltExecutable: topology.doltExecutable,
    prefix: topology.prefix,
    projections,
    scope: config.scope,
    ...topology.remote === void 0 ? {} : { remote: topology.remote }
  });
  const adapter = new EmbeddedBeadsAdapter({
    holder: config.initialRun.controller.holder,
    mode: topology.mode,
    prefix: topology.prefix,
    preflight: topology.preflight,
    process: process2,
    scope: config.scope
  });
  return createProductionRecoveryCommandRunner({
    git: { ...config.git, runner: nodeGitRunner },
    initialRun: config.initialRun,
    nonce: config.nonce,
    preOwnership: adapter,
    proveTopology: async () => await embeddedTopologyProof(config, process2),
    store: adapter,
    topology: adapter
  });
}
async function sharedServerRunner(config, topology, environment = (name) => process.env[name]) {
  const writerPassword = environment(topology.writerEnvironment);
  const workerPassword = environment(topology.workerEnvironment);
  if (writerPassword === void 0 || workerPassword === void 0)
    return void 0;
  try {
    const writer = new DoltSqlTransport({
      executable: topology.doltExecutable,
      identity: topology.identity,
      password: writerPassword,
      user: topology.writerUser
    });
    const worker = new DoltSqlTransport({
      executable: topology.doltExecutable,
      identity: topology.identity,
      password: workerPassword,
      user: topology.workerUser
    });
    const childRuntime = topology.managed ? runtimeEnvironment(topology) : void 0;
    const slotProcess = new PinnedBdServerProcess({
      credentialEnvironment: () => ({ BEADS_DOLT_PASSWORD: writerPassword }),
      executable: topology.bdExecutable,
      identity: topology.identity,
      ...childRuntime === void 0 ? {} : { runtimeEnvironment: childRuntime },
      workspace: topology.workspace
    });
    const managedProcess = topology.managed ? new PinnedBdManagedServerProcess({
      dataDirectory: topology.dataDirectory,
      doltExecutable: topology.doltExecutable,
      executable: topology.bdExecutable,
      runtimeEnvironment: runtimeEnvironment(topology),
      workspace: topology.workspace
    }) : void 0;
    const driver = new DoltBeadsServerDriver({
      identity: topology.identity,
      rows: topology.rows,
      slotProcess,
      worker,
      writer
    });
    const adapter = new BeadsServerAdapter({
      driver,
      identity: topology.identity,
      recoveryScope: config.scope,
      ...managedProcess === void 0 ? {} : { process: managedProcess }
    });
    if ((await adapter.preflight()).status !== "ready") return void 0;
    return createProductionRecoveryCommandRunner({
      git: { ...config.git, runner: nodeGitRunner },
      initialRun: config.initialRun,
      nonce: config.nonce,
      preOwnership: adapter,
      proveTopology: async () => await topologyProof(config),
      store: adapter,
      topology: adapter
    });
  } catch {
    return void 0;
  }
}
async function createControllerConfigRunner(path2, dependencies = {}) {
  if (!isAbsolute6(path2)) return void 0;
  let source;
  try {
    source = await readFile(path2, "utf8");
  } catch {
    return void 0;
  }
  if (Buffer.byteLength(source, "utf8") > MAX_CONFIG_BYTES) return void 0;
  let input;
  try {
    input = JSON.parse(source);
  } catch {
    return void 0;
  }
  const config = parseControllerConfig(input);
  if (config === void 0) return void 0;
  const topology = config.topology;
  if (topology.kind === "embedded")
    return dependencies.composeEmbedded?.(config, topology) ?? embeddedRunner(config, topology);
  const environment = dependencies.environment ?? ((name) => process.env[name]);
  const writerPassword = environment(topology.writerEnvironment);
  const workerPassword = environment(topology.workerEnvironment);
  if (writerPassword === void 0 || workerPassword === void 0)
    return void 0;
  if (dependencies.composeShared !== void 0)
    return await dependencies.composeShared(config, topology, {
      workerPassword,
      writerPassword
    });
  return await sharedServerRunner(
    config,
    topology,
    (name) => name === topology.writerEnvironment ? writerPassword : name === topology.workerEnvironment ? workerPassword : void 0
  );
}

// src/cli.ts
var CLI_VERSION = "0.1.0";
var REQUEST_SCHEMA = "sce.command.request";
var RESPONSE_SCHEMA = "sce.cli.response";
var SCHEMA_VERSION2 = 1;
var EXIT_USAGE = 64;
var EXIT_UNAVAILABLE = 69;
var EXIT_SOFTWARE = 70;
var knownOptions = /* @__PURE__ */ new Set([
  "--controller-config",
  "--expected-revision",
  "--help",
  "--idempotency-key",
  "--json",
  "--request"
]);
var CliError = class extends Error {
  code;
  exitCode;
  constructor(code, message, exitCode = EXIT_USAGE) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
    this.name = "CliError";
  }
};
function parseCliArguments(argv) {
  if (argv.length === 0) {
    throw new CliError("SCE_MISSING_COMMAND", "A command is required.");
  }
  const first = argv[0];
  if (first === void 0) {
    throw new CliError("SCE_MISSING_COMMAND", "A command is required.");
  }
  if (first === "--help" || first === "-h") {
    if (argv.length !== 1) {
      throw new CliError(
        "SCE_UNEXPECTED_ARGUMENT",
        "--help does not accept arguments."
      );
    }
    return { kind: "help" };
  }
  if (first === "--version" || first === "-V") {
    if (argv.length !== 1) {
      throw new CliError(
        "SCE_UNEXPECTED_ARGUMENT",
        "--version does not accept arguments."
      );
    }
    return { kind: "version" };
  }
  if (first.startsWith("-")) {
    throw new CliError("SCE_UNKNOWN_OPTION", "Unknown option.");
  }
  if (!isCommandName(first)) {
    throw new CliError("SCE_UNKNOWN_COMMAND", "Unknown command.");
  }
  return parseCommand(first, argv.slice(1));
}
function parseCommand(command, argv) {
  const positionals = [];
  const values = /* @__PURE__ */ new Map();
  let optionsEnded = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === void 0) {
      continue;
    }
    if (token === "--") {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && token.startsWith("-")) {
      const [option, inlineValue] = splitOption(token);
      if (option === "-h") {
        setOption(values, "--help", true);
        continue;
      }
      if (!knownOptions.has(option)) {
        throw new CliError("SCE_UNKNOWN_OPTION", "Unknown option.");
      }
      if (option === "--json" || option === "--help") {
        if (inlineValue !== void 0) {
          throw new CliError(
            "SCE_INVALID_OPTION_VALUE",
            `${option} does not accept a value.`
          );
        }
        setOption(values, option, true);
        continue;
      }
      const value = inlineValue ?? argv[++index];
      if (value === void 0 || value === "--" || value.startsWith("--")) {
        throw new CliError(
          "SCE_MISSING_OPTION_VALUE",
          `${option} requires a value.`
        );
      }
      setOption(values, option, value);
      continue;
    }
    positionals.push(token);
  }
  if (values.has("--help")) {
    if (positionals.length > 0) {
      throw new CliError(
        "SCE_UNEXPECTED_ARGUMENT",
        "--help does not accept arguments."
      );
    }
    return { command, kind: "help" };
  }
  const feedbackAction = parsePositionals(command, positionals);
  const request = {
    command,
    ...feedbackAction === void 0 ? {} : { feedbackAction },
    options: parseOptions(values),
    schema: REQUEST_SCHEMA,
    version: SCHEMA_VERSION2
  };
  if (!validateCommandRequest(request))
    throw new CliError(
      "SCE_INVALID_REQUEST",
      "The command request is invalid."
    );
  const controllerConfig = optionValue(values, "--controller-config");
  return {
    ...controllerConfig === void 0 ? {} : { controllerConfig: parseControllerConfigPath(controllerConfig) },
    kind: "command",
    request
  };
}
function splitOption(token) {
  const equalsIndex = token.indexOf("=");
  return equalsIndex === -1 ? [token, void 0] : [token.slice(0, equalsIndex), token.slice(equalsIndex + 1)];
}
function setOption(values, option, value) {
  if (values.has(option)) {
    throw new CliError(
      "SCE_DUPLICATE_OPTION",
      `Option may be specified once: ${option}`
    );
  }
  values.set(option, value);
}
function parsePositionals(command, positionals) {
  if (command !== "feedback") {
    if (positionals.length > 0) {
      throw new CliError("SCE_UNEXPECTED_ARGUMENT", "Unexpected argument.");
    }
    return void 0;
  }
  if (positionals.length === 0) {
    throw new CliError(
      "SCE_MISSING_ARGUMENT",
      "feedback requires one action: prepare, preview, submit, or flush."
    );
  }
  if (positionals.length > 1) {
    throw new CliError("SCE_UNEXPECTED_ARGUMENT", "Unexpected argument.");
  }
  const action = positionals[0];
  if (action === void 0 || !isFeedbackAction(action)) {
    throw new CliError("SCE_INVALID_ARGUMENT", "Unknown feedback action.");
  }
  return action;
}
function parseOptions(values) {
  const expectedRevision = optionValue(values, "--expected-revision");
  const idempotencyKey2 = optionValue(values, "--idempotency-key");
  const request = optionValue(values, "--request");
  return {
    ...expectedRevision === void 0 ? {} : { expectedRevision: parseExpectedRevision(expectedRevision) },
    ...idempotencyKey2 === void 0 ? {} : { idempotencyKey: parseNonEmpty(idempotencyKey2, "--idempotency-key") },
    json: values.has("--json"),
    ...request === void 0 ? {} : { request: parseRequest(request) }
  };
}
function parseControllerConfigPath(value) {
  if (!isAbsolute7(value) || value.length > 4096 || value.includes("\0"))
    throw new CliError(
      "SCE_INVALID_OPTION_VALUE",
      "--controller-config must be an absolute path."
    );
  const path2 = normalize4(resolve4(value));
  if (path2 === "/")
    throw new CliError(
      "SCE_INVALID_OPTION_VALUE",
      "--controller-config must be an absolute path."
    );
  return path2;
}
function optionValue(values, option) {
  const value = values.get(option);
  return typeof value === "string" ? value : void 0;
}
function parseExpectedRevision(value) {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new CliError(
      "SCE_INVALID_OPTION_VALUE",
      "--expected-revision must be a non-negative integer."
    );
  }
  const revision3 = Number(value);
  if (!Number.isSafeInteger(revision3)) {
    throw new CliError(
      "SCE_INVALID_OPTION_VALUE",
      "--expected-revision must be a safe integer."
    );
  }
  return revision3;
}
function parseNonEmpty(value, option) {
  if (value.length === 0) {
    throw new CliError(
      "SCE_INVALID_OPTION_VALUE",
      `${option} must not be empty.`
    );
  }
  return value;
}
function parseRequest(value) {
  if (new TextEncoder().encode(value).byteLength > MAX_CLI_REQUEST_BYTES)
    throw new CliError(
      "SCE_REQUEST_TOO_LARGE",
      "--request exceeds the 128 KiB limit."
    );
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new CliError("SCE_INVALID_JSON", "--request must be valid JSON.");
  }
  if (!validateCommandPayload(parsed))
    throw new CliError(
      "SCE_INVALID_OPTION_VALUE",
      "--request must be a bounded JSON object."
    );
  return parsed;
}
async function runCli(argv, dependencies = {}) {
  try {
    const invocation = parseCliArguments(argv);
    if (invocation.kind === "help") {
      return success(
        helpResult(invocation.command, dependencies.version ?? CLI_VERSION)
      );
    }
    if (invocation.kind === "version") {
      return success({ version: dependencies.version ?? CLI_VERSION });
    }
    const runner = invocation.controllerConfig === void 0 ? dependencies.runner ?? stateOnlyCommandRunner : await (dependencies.controllerConfigRunner ?? createControllerConfigRunner)(invocation.controllerConfig);
    if (runner === void 0)
      return failure(
        "SCE_CONTROLLER_CONFIG_UNAVAILABLE",
        "The explicit controller configuration is unavailable.",
        EXIT_UNAVAILABLE,
        invocation.request.command
      );
    let outcome;
    try {
      outcome = await runner(invocation.request);
    } catch {
      return failure(
        "SCE_RUNNER_FAILURE",
        "The command runner failed without a usable response.",
        EXIT_SOFTWARE,
        invocation.request.command
      );
    }
    if (!validateCommandRunnerResult(outcome)) {
      return failure(
        "SCE_INVALID_RUNNER_RESULT",
        "The command runner returned an invalid result.",
        EXIT_SOFTWARE,
        invocation.request.command
      );
    }
    if (outcome.status === "unavailable") {
      return failure(
        "SCE_COMMAND_UNAVAILABLE",
        `The ${invocation.request.command} command is unavailable.`,
        EXIT_UNAVAILABLE,
        invocation.request.command
      );
    }
    if (outcome.status === "invalid") {
      return failure(
        outcome.code,
        "The request does not contain a valid repository run.",
        EXIT_USAGE,
        invocation.request.command
      );
    }
    if (outcome.status === "blocked") {
      return failure(
        outcome.code,
        `The ${invocation.request.command} command is blocked pending authoritative recovery.`,
        EXIT_UNAVAILABLE,
        invocation.request.command
      );
    }
    return success(outcome.result, invocation.request.command);
  } catch (error) {
    if (error instanceof CliError) {
      return failure(error.code, error.message, error.exitCode);
    }
    return failure(
      "SCE_INTERNAL_ERROR",
      "The CLI failed unexpectedly.",
      EXIT_SOFTWARE
    );
  }
}
async function main(argv, dependencies = {}, write = (value) => process.stdout.write(value)) {
  const execution2 = await runCli(argv, dependencies);
  write(execution2.stdout);
  return execution2.exitCode;
}
function success(result2, command) {
  return execution(
    {
      ...command === void 0 ? {} : { command },
      ok: true,
      result: result2,
      schema: RESPONSE_SCHEMA,
      version: SCHEMA_VERSION2
    },
    0
  );
}
function failure(code, message, exitCode, command) {
  return execution(
    {
      ...command === void 0 ? {} : { command },
      error: { code, message },
      ok: false,
      schema: RESPONSE_SCHEMA,
      version: SCHEMA_VERSION2
    },
    exitCode
  );
}
function execution(response, exitCode) {
  const stdout = `${canonicalJson2(response)}
`;
  if (new TextEncoder().encode(stdout).byteLength <= MAX_CLI_RESPONSE_BYTES)
    return { exitCode, response, stdout };
  const boundedResponse = {
    error: {
      code: "SCE_RESULT_TOO_LARGE",
      message: "The command result exceeds the 128 KiB limit."
    },
    ok: false,
    schema: RESPONSE_SCHEMA,
    version: SCHEMA_VERSION2
  };
  return {
    exitCode: EXIT_SOFTWARE,
    response: boundedResponse,
    stdout: `${canonicalJson2(boundedResponse)}
`
  };
}
function helpResult(command, version) {
  if (command === void 0) {
    return {
      commands: [...commandNames],
      name: "sce",
      usage: "sce <command> [--controller-config <absolute path>] [--json] [--request <json>] [--expected-revision <n>] [--idempotency-key <key>]",
      version
    };
  }
  return {
    ...command === "feedback" ? { actions: [...feedbackActions] } : {},
    command,
    usage: command === "feedback" ? "sce feedback <prepare|preview|submit|flush> [--controller-config <absolute path>] [--json] [--request <json>] [--expected-revision <n>] [--idempotency-key <key>]" : `sce ${command} [--controller-config <absolute path>] [--json] [--request <json>] [--expected-revision <n>] [--idempotency-key <key>]`
  };
}
function canonicalJson2(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("JSON numbers must be finite.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson2(item)).join(",")}]`;
  }
  if (typeof value !== "object") {
    throw new TypeError("Value is not JSON serializable.");
  }
  const object5 = value;
  return `{${Object.keys(object5).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson2(object5[key])}`).join(",")}}`;
}
function isEntrypoint() {
  const entrypoint = process.argv[1];
  if (entrypoint === void 0) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(realpathSync5(entrypoint)).href;
  } catch {
    return false;
  }
}
if (isEntrypoint()) {
  void main(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
export {
  CLI_VERSION,
  CliError,
  REQUEST_SCHEMA,
  RESPONSE_SCHEMA,
  SCHEMA_VERSION2 as SCHEMA_VERSION,
  canonicalJson2 as canonicalJson,
  main,
  parseCliArguments,
  runCli
};
