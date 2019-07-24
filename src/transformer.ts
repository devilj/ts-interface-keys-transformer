import * as ts from 'typescript';
import * as path from 'path';

export default (program: ts.Program): ts.TransformerFactory<ts.SourceFile> => {
  return (ctx: ts.TransformationContext) => {
    return (sourceFile: ts.SourceFile): ts.SourceFile => {
      const visitor = (node: ts.Node): ts.Node => {
        return ts.visitEachChild(visitNode(node, program), visitor, ctx);
      };
      return <ts.SourceFile> ts.visitEachChild(visitNode(sourceFile, program), visitor, ctx);
    };
  };
}

interface InterfaceProperty {
  name: string;
  optional: boolean;
}

const symbolMap = new Map<string, ts.Symbol>();

const visitNode = (node: ts.Node, program: ts.Program): ts.Node => {
  if (node.kind === ts.SyntaxKind.SourceFile) {
    (<any>node).locals.forEach((value: any, key: string) => {
      if (!symbolMap.get(key)) {
        symbolMap.set(key, value);
      }
    });
  }
  const typeChecker = program.getTypeChecker();
  if (!isKeysCallExpression(node, typeChecker)) {
    return node;
  }
  if (!node.typeArguments) {
    return ts.createArrayLiteral([]);
  }
  const type = typeChecker.getTypeFromTypeNode(node.typeArguments[0]);
  let properties: InterfaceProperty[] = [];
  const symbols = typeChecker.getPropertiesOfType(type);
  symbols.forEach(symbol => {
    properties = [ ...properties, ...getPropertiesOfSymbol(symbol, [], symbolMap) ];
  });

  return ts.createArrayLiteral(properties.map(property => ts.createRegularExpressionLiteral(JSON.stringify(property))));
};

const getPropertiesOfSymbol = (symbol: ts.Symbol, outerLayerProperties: InterfaceProperty[], symbolMap: Map<string, ts.Symbol>): InterfaceProperty[] => {
  let properties: InterfaceProperty[] = [];
  let propertyPathElements = JSON.parse(JSON.stringify(outerLayerProperties.map(property => property)));
  const property = symbol.escapedName;
  propertyPathElements.push(property);
  let optional = true;
  for (let declaration of symbol.declarations) {
    if (undefined === (<any>declaration).questionToken) {
      optional = false;
      break;
    }
  }
  const key = <InterfaceProperty> {
    name: propertyPathElements.join('.'),
    optional,
  };
  properties.push(key);

  const propertiesOfSymbol = _getPropertiesOfSymbol(symbol, propertyPathElements, symbolMap);
  properties = [
    ...properties,
    ...propertiesOfSymbol,
  ];

  return properties;
};

const isOutermostLayerSymbol = (symbol: any): boolean => {
  return symbol.valueDeclaration && symbol.valueDeclaration.symbol.valueDeclaration.type.members;
};

const isInnerLayerSymbol = (symbol: any): boolean => {
  return symbol.valueDeclaration && symbol.valueDeclaration.symbol.valueDeclaration.type.typeName;
};

const _getPropertiesOfSymbol = (symbol: ts.Symbol, propertyPathElements: InterfaceProperty[], symbolMap: Map<string, ts.Symbol>): InterfaceProperty[] => {
  if (!isOutermostLayerSymbol(symbol) && !isInnerLayerSymbol(symbol)) {
    return [];
  }
  let properties: InterfaceProperty[] = [];
  let members: any;
  if ((<any>symbol.valueDeclaration).type.symbol) {
    members = (<any>symbol.valueDeclaration).type.members.map((member: any) => member.symbol);
  } else {
    const propertyTypeName = (<any>symbol.valueDeclaration).type.typeName.escapedText;
    const propertyTypeSymbol = symbolMap.get(propertyTypeName);
    if (propertyTypeSymbol) {
      if (propertyTypeSymbol.members) {
        members = propertyTypeSymbol.members;
      } else {
        members = (<any>propertyTypeSymbol).exportSymbol.members;
      }
    }
  }
  if (members) {
    members.forEach((member: any) => {
      properties = [
        ...properties,
        ...getPropertiesOfSymbol(member, propertyPathElements, symbolMap),
      ];
    });
  }

  return properties;
};

const indexTs = path.join(__dirname, '../index.ts');
const isKeysCallExpression = (node: ts.Node, typeChecker: ts.TypeChecker): node is ts.CallExpression => {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  const signature = typeChecker.getResolvedSignature(node);
  if (typeof signature === 'undefined') {
    return false;
  }
  const { declaration } = signature;
  return !!declaration
    && !ts.isJSDocSignature(declaration)
    && (path.join(declaration.getSourceFile().fileName) === indexTs)
    && !!declaration.name
    && declaration.name.getText() === 'keys';
};
