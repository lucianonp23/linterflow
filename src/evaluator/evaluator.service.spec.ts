import { Test, TestingModule } from '@nestjs/testing';
import { EvaluatorService } from './evaluator.service';
import * as fs from 'fs';
import * as path from 'path';

describe('EvaluatorService', () => {
  let service: EvaluatorService;

  beforeEach(async () => {
    // Create a NestJS testing module to inject our service
    const module: TestingModule = await Test.createTestingModule({
      providers: [EvaluatorService],
    }).compile();

    service = module.get<EvaluatorService>(EvaluatorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // --- TYPESCRIPT PARAMETER PROPERTIES ---
  // `constructor(private readonly x: T)` parses to TSParameterProperty, which
  // escomplex's code generator does not know and fails the whole file on. It is
  // how every NestJS class declares its dependencies, so before this was handled
  // the analyser could not measure ordinary NestJS code at all.
  describe('TypeScript parameter properties', () => {
    it('analyses a class that injects its dependencies', () => {
      const code = `
        @Injectable()
        export class UsersService {
          constructor(
            private readonly repo: UserRepository,
            private readonly config: ConfigService,
          ) {}
          find(id: string) {
            if (!id) { throw new Error('no id'); }
            return this.repo.findOne(id);
          }
        }
      `;

      expect(() => service.analyzeMetrics(code)).not.toThrow();
      const metrics = service.analyzeMetrics(code);
      expect(metrics.functionCount).toBeGreaterThan(0);
      expect(metrics.maintainabilityIndex).toBeGreaterThan(0);
    });

    it('handles optional and decorated parameter properties', () => {
      const code = `
        export class A {
          constructor(@Inject('TOKEN') private readonly dep?: Thing) {}
          run() { return this.dep; }
        }
      `;

      expect(() => service.analyzeMetrics(code)).not.toThrow();
    });

    // The unwrap swaps one node for one node, so a constructor keeps its arity
    // and its branching. If this drifts, previously measured corpora stop being
    // comparable with anything measured afterwards.
    it('measures the same complexity as the equivalent plain parameters', () => {
      const withProperties = `
        export class A {
          constructor(private readonly a: X, private readonly b: Y) {}
          run(n: number) {
            if (n > 0) { return 1; }
            if (n < 0) { return -1; }
            return 0;
          }
        }
      `;
      const withPlainParams = `
        export class A {
          constructor(a: X, b: Y) {}
          run(n: number) {
            if (n > 0) { return 1; }
            if (n < 0) { return -1; }
            return 0;
          }
        }
      `;

      const a = service.analyzeMetrics(withProperties);
      const b = service.analyzeMetrics(withPlainParams);

      expect(a.cyclomaticComplexity).toBe(b.cyclomaticComplexity);
      expect(a.totalCyclomaticComplexity).toBe(b.totalCyclomaticComplexity);
      expect(a.functionCount).toBe(b.functionCount);
    });

    it('leaves a file without parameter properties untouched', () => {
      const code = `
        export function pick(n: number) {
          if (n > 10) { return 'big'; }
          return 'small';
        }
      `;

      const metrics = service.analyzeMetrics(code);
      expect(metrics.cyclomaticComplexity).toBe(2);
      expect(metrics.functionCount).toBe(1);
    });
  });

  // --- 1. AST PARSING TEST ---
  it('should generate a valid AST from a code string', () => {
    // 1. The mock code we are going to evaluate
    const mockCode = `
      function calculateSum(a: number, b: number): number {
        if (a < 0) return 0;
        return a + b;
      }
    `;

    // 2. Execute our service
    const ast = service.generateAST(mockCode);

    // 3. Verify it worked
    expect(ast).toBeDefined();
    expect(ast.type).toBe('File'); // Babel always returns a 'File' type at the root
    expect(ast.program.body.length).toBeGreaterThan(0); // Ensures it read the content
    
    // Bonus: Print a small piece of the AST to the terminal just to "see" the magic
    console.log('--- AST SUCCESSFULLY GENERATED ---');
    console.log(`Type of the first node: ${ast.program.body[0].type}`); 
    // Should print: "FunctionDeclaration"
  });

  // --- 2. COMPLEXITY & MAINTAINABILITY TEST ---
  it('should calculate cyclomatic complexity and MI from a string', () => {
    // 1. Simple code: Only 1 logical path
    const simpleCode = `
      function add(a, b) {
        return a + b;
      }
    `;

    // 2. Complex code: 4 logical paths (Ifs and Else Ifs)
    const complexCode = `
      function evaluateGrade(grade) {
        if (grade > 90) {
          return 'A';
        } else if (grade > 80) {
          return 'B';
        } else if (grade > 70) {
          return 'C';
        } else {
          return 'F';
        }
      }
    `;

    const simpleMetrics = service.analyzeMetrics(simpleCode);
    const complexMetrics = service.analyzeMetrics(complexCode);

    // Validations
    expect(simpleMetrics).toBeDefined();
    
    // Complexity of the simple function should be lower than the complex one
    expect(simpleMetrics.cyclomaticComplexity).toBeLessThan(complexMetrics.cyclomaticComplexity);
    
    // Maintainability Index (MI) of simple code should be HIGHER (better) than complex code
    expect(simpleMetrics.maintainabilityIndex).toBeGreaterThan(complexMetrics.maintainabilityIndex);

    console.log('--- COMPLEXITY COMPARISON ---');
    console.log(`Simple Code -> Complexity: ${simpleMetrics.cyclomaticComplexity} | MI: ${simpleMetrics.maintainabilityIndex.toFixed(2)}`);
    console.log(`Complex Code -> Complexity: ${complexMetrics.cyclomaticComplexity} | MI: ${complexMetrics.maintainabilityIndex.toFixed(2)}`);
  });

  // --- 3. DRY DUPLICATION TEST ---
  it('should detect duplicated code blocks using jscpd', async () => {
    // 1. Setup: Create a temporary directory and two identical files
    const tempDir = path.join(__dirname, 'temp-test-dir');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const duplicatedCode = `
      export function calculateUserTax(value: number, taxRate: number): number {
        let result = value * taxRate;
        console.log("Processing tax in the system");
        console.log("Adding an extra line to guarantee jscpd catches this block");
        
        if (result > 100) {
          result = result - 10; // apply discount
        }
        
        const stateTax = result * 0.05;
        const finalAmount = result + stateTax;
        
        return finalAmount;
      }
    `;

    fs.writeFileSync(path.join(tempDir, 'fileA.ts'), duplicatedCode);
    fs.writeFileSync(path.join(tempDir, 'fileB.ts'), duplicatedCode);

    // 2. Action: Tell the Evaluator to scan the folder
    const duplications = await service.detectDuplications(tempDir);

    // 3. Validation: It should find the duplication
    console.log(duplications.values);
    expect(duplications).toBeDefined();
    expect(duplications.length).toBeGreaterThan(0);
    expect(duplications[0].fragment).toContain('calculateUserTax');

    console.log('--- DUPLICATION TEST ---');
    console.log(`Detected ${duplications.length} clone(s). Snippet: \n${duplications[0].fragment.substring(0, 50)}...`);

    // 4. Cleanup: Delete temporary files after the test
    fs.unlinkSync(path.join(tempDir, 'fileA.ts'));
    fs.unlinkSync(path.join(tempDir, 'fileB.ts'));
    fs.rmdirSync(tempDir);
  });
});