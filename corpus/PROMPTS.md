# LinterFlow — Zero-Shot Corpus Prompts

60 prompts: 5 NestJS component types × 3 complexity tiers × 4 files.

Intended CC bands (maximum Cyclomatic Complexity per function): Low = `max CC <= 5`, Medium = `5 < max CC <= 10`, High = `max CC > 10`.

## Materialising these prompts (phase 1b)

Two ways to turn the prompts below into measured corpus files.
Both preserve the Zero-Shot condition — it lives in the CONTENT of the
prompt, not in the channel it travels through.

### Automated (recommended) — ~3 h

```bash
npm run corpus:build            # generate + measure + regenerate what is missing
npm run corpus:build -- --measure-only   # re-measure only, no API calls
```

Generates through the Gemini API at temperature 0.9, measures with the same
EvaluatorService the pipeline uses, and regenerates anything outside its tier
band. Records `measuredCC/MI/DR`, `inBand`, `generatedWith` and `attempts`.

### Manual — ~13 h

1. Copy a prompt below into your AI agent / chat assistant.
2. Save the returned code verbatim as `corpus/<type>_<tier>_<index>.ts`.
3. Measure it: `npm run corpus:build -- --measure-only`.
4. **Tier verification:** if the measured CC is OUTSIDE the intended band, discard
   the file and regenerate with the SAME prompt until it lands within band.
5. Record the model used in `generatedWith` — keep it identical across all 60.

### Rules that apply to both

- Do not edit the prompts to mention quality, metrics, clean code, or patterns —
  that would break the Zero-Shot condition the experiment depends on.
- Do not edit a prompt to steer its measured CC either. Regeneration relies on the
  model's non-determinism, with the prompt kept byte-identical between attempts.
- Keep the same model across all 60 files: it is a controlled variable.

### 1. `controller_low_1.ts`  —  tier: low (max CC <= 5)

```text
Generate a NestJS REST Controller (use @Controller and HTTP method decorators such as @Get/@Post/@Put/@Delete) that exposes endpoints for the domain below and applies the domain rules inline in the handlers.
Domain: a personal bookmark manager.
Scope: a simple domain with very few rules. Implement the operations with mostly straight-line logic and minimal conditional branching.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 2. `controller_low_2.ts`  —  tier: low (max CC <= 5)

```text
Generate a NestJS REST Controller (use @Controller and HTTP method decorators such as @Get/@Post/@Put/@Delete) that exposes endpoints for the domain below and applies the domain rules inline in the handlers.
Domain: a to-do list.
Scope: a simple domain with very few rules. Implement the operations with mostly straight-line logic and minimal conditional branching.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 3. `controller_low_3.ts`  —  tier: low (max CC <= 5)

```text
Generate a NestJS REST Controller (use @Controller and HTTP method decorators such as @Get/@Post/@Put/@Delete) that exposes endpoints for the domain below and applies the domain rules inline in the handlers.
Domain: a contact address book.
Scope: a simple domain with very few rules. Implement the operations with mostly straight-line logic and minimal conditional branching.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 4. `controller_low_4.ts`  —  tier: low (max CC <= 5)

```text
Generate a NestJS REST Controller (use @Controller and HTTP method decorators such as @Get/@Post/@Put/@Delete) that exposes endpoints for the domain below and applies the domain rules inline in the handlers.
Domain: a movie watchlist.
Scope: a simple domain with very few rules. Implement the operations with mostly straight-line logic and minimal conditional branching.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 5. `controller_medium_1.ts`  —  tier: medium (5 < max CC <= 10)

```text
Generate a NestJS REST Controller (use @Controller and HTTP method decorators such as @Get/@Post/@Put/@Delete) that exposes endpoints for the domain below and applies the domain rules inline in the handlers.
Domain: an event booking system with availability and cancellation refund rules.
Scope: a domain with a moderate set of business rules — four to seven independent validity or state checks in its busiest operation, and fewer in the others. Implement each check as a direct conditional; the checks stand alone rather than combining into nested special cases.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 6. `controller_medium_2.ts`  —  tier: medium (5 < max CC <= 10)

```text
Generate a NestJS REST Controller (use @Controller and HTTP method decorators such as @Get/@Post/@Put/@Delete) that exposes endpoints for the domain below and applies the domain rules inline in the handlers.
Domain: a hotel room reservation with date-overlap checks.
Scope: a domain with a moderate set of business rules — four to seven independent validity or state checks in its busiest operation, and fewer in the others. Implement each check as a direct conditional; the checks stand alone rather than combining into nested special cases.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 7. `controller_medium_3.ts`  —  tier: medium (5 < max CC <= 10)

```text
Generate a NestJS REST Controller (use @Controller and HTTP method decorators such as @Get/@Post/@Put/@Delete) that exposes endpoints for the domain below and applies the domain rules inline in the handlers.
Domain: a shopping cart with discount tiers and coupon validation.
Scope: a domain with a moderate set of business rules — four to seven independent validity or state checks in its busiest operation, and fewer in the others. Implement each check as a direct conditional; the checks stand alone rather than combining into nested special cases.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 8. `controller_medium_4.ts`  —  tier: medium (5 < max CC <= 10)

```text
Generate a NestJS REST Controller (use @Controller and HTTP method decorators such as @Get/@Post/@Put/@Delete) that exposes endpoints for the domain below and applies the domain rules inline in the handlers.
Domain: a leave/holiday request approval with per-employee quotas.
Scope: a domain with a moderate set of business rules — four to seven independent validity or state checks in its busiest operation, and fewer in the others. Implement each check as a direct conditional; the checks stand alone rather than combining into nested special cases.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 9. `controller_high_1.ts`  —  tier: high (max CC > 10)

```text
Generate a NestJS REST Controller (use @Controller and HTTP method decorators such as @Get/@Post/@Put/@Delete) that exposes endpoints for the domain below and applies the domain rules inline in the handlers.
Domain: an insurance claims workflow (claim type, customer tier, coverage limits, fraud flags).
Scope: a rule-heavy domain with many interacting business rules, edge cases and special conditions. Implement every rule and edge case fully and explicitly, even where this leads to deeply nested conditionals, multiple loops and switch statements.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 10. `controller_high_2.ts`  —  tier: high (max CC > 10)

```text
Generate a NestJS REST Controller (use @Controller and HTTP method decorators such as @Get/@Post/@Put/@Delete) that exposes endpoints for the domain below and applies the domain rules inline in the handlers.
Domain: a loan approval engine (credit-score bands, income, collateral, risk tiers).
Scope: a rule-heavy domain with many interacting business rules, edge cases and special conditions. Implement every rule and edge case fully and explicitly, even where this leads to deeply nested conditionals, multiple loops and switch statements.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 11. `controller_high_3.ts`  —  tier: high (max CC > 10)

```text
Generate a NestJS REST Controller (use @Controller and HTTP method decorators such as @Get/@Post/@Put/@Delete) that exposes endpoints for the domain below and applies the domain rules inline in the handlers.
Domain: an e-commerce checkout (tax, shipping, multiple coupons, inventory, fraud checks).
Scope: a rule-heavy domain with many interacting business rules, edge cases and special conditions. Implement every rule and edge case fully and explicitly, even where this leads to deeply nested conditionals, multiple loops and switch statements.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 12. `controller_high_4.ts`  —  tier: high (max CC > 10)

```text
Generate a NestJS REST Controller (use @Controller and HTTP method decorators such as @Get/@Post/@Put/@Delete) that exposes endpoints for the domain below and applies the domain rules inline in the handlers.
Domain: a payroll calculation (tax brackets, overtime, deductions, benefits).
Scope: a rule-heavy domain with many interacting business rules, edge cases and special conditions. Implement every rule and edge case fully and explicitly, even where this leads to deeply nested conditionals, multiple loops and switch statements.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 13. `service_low_1.ts`  —  tier: low (max CC <= 5)

```text
Generate a NestJS @Injectable() Service that contains the business logic for the domain below.
Domain: a reading list tracker.
Scope: a simple domain with very few rules. Implement the operations with mostly straight-line logic and minimal conditional branching.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 14. `service_low_2.ts`  —  tier: low (max CC <= 5)

```text
Generate a NestJS @Injectable() Service that contains the business logic for the domain below.
Domain: a recipe ingredient list.
Scope: a simple domain with very few rules. Implement the operations with mostly straight-line logic and minimal conditional branching.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 15. `service_low_3.ts`  —  tier: low (max CC <= 5)

```text
Generate a NestJS @Injectable() Service that contains the business logic for the domain below.
Domain: a daily water-intake log.
Scope: a simple domain with very few rules. Implement the operations with mostly straight-line logic and minimal conditional branching.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 16. `service_low_4.ts`  —  tier: low (max CC <= 5)

```text
Generate a NestJS @Injectable() Service that contains the business logic for the domain below.
Domain: a habit check-off tracker.
Scope: a simple domain with very few rules. Implement the operations with mostly straight-line logic and minimal conditional branching.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 17. `service_medium_1.ts`  —  tier: medium (5 < max CC <= 10)

```text
Generate a NestJS @Injectable() Service that contains the business logic for the domain below.
Domain: a parking-lot allocation with vehicle-type rules.
Scope: a domain with a moderate set of business rules — four to seven independent validity or state checks in its busiest operation, and fewer in the others. Implement each check as a direct conditional; the checks stand alone rather than combining into nested special cases.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 18. `service_medium_2.ts`  —  tier: medium (5 < max CC <= 10)

```text
Generate a NestJS @Injectable() Service that contains the business logic for the domain below.
Domain: a subscription billing with plan upgrades and downgrades.
Scope: a domain with a moderate set of business rules — four to seven independent validity or state checks in its busiest operation, and fewer in the others. Implement each check as a direct conditional; the checks stand alone rather than combining into nested special cases.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 19. `service_medium_3.ts`  —  tier: medium (5 < max CC <= 10)

```text
Generate a NestJS @Injectable() Service that contains the business logic for the domain below.
Domain: a food-delivery order with zone-based delivery fees.
Scope: a domain with a moderate set of business rules — four to seven independent validity or state checks in its busiest operation, and fewer in the others. Implement each check as a direct conditional; the checks stand alone rather than combining into nested special cases.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 20. `service_medium_4.ts`  —  tier: medium (5 < max CC <= 10)

```text
Generate a NestJS @Injectable() Service that contains the business logic for the domain below.
Domain: a library loan with overdue fines and renewal limits.
Scope: a domain with a moderate set of business rules — four to seven independent validity or state checks in its busiest operation, and fewer in the others. Implement each check as a direct conditional; the checks stand alone rather than combining into nested special cases.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 21. `service_high_1.ts`  —  tier: high (max CC > 10)

```text
Generate a NestJS @Injectable() Service that contains the business logic for the domain below.
Domain: a tax-return assessment (multiple income types, deductions, credits).
Scope: a rule-heavy domain with many interacting business rules, edge cases and special conditions. Implement every rule and edge case fully and explicitly, even where this leads to deeply nested conditionals, multiple loops and switch statements.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 22. `service_high_2.ts`  —  tier: high (max CC > 10)

```text
Generate a NestJS @Injectable() Service that contains the business logic for the domain below.
Domain: an order-fulfilment routing (warehouse stock, carrier rules, SLAs).
Scope: a rule-heavy domain with many interacting business rules, edge cases and special conditions. Implement every rule and edge case fully and explicitly, even where this leads to deeply nested conditionals, multiple loops and switch statements.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 23. `service_high_3.ts`  —  tier: high (max CC > 10)

```text
Generate a NestJS @Injectable() Service that contains the business logic for the domain below.
Domain: a fraud-detection scoring engine (multiple weighted signals and thresholds).
Scope: a rule-heavy domain with many interacting business rules, edge cases and special conditions. Implement every rule and edge case fully and explicitly, even where this leads to deeply nested conditionals, multiple loops and switch statements.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 24. `service_high_4.ts`  —  tier: high (max CC > 10)

```text
Generate a NestJS @Injectable() Service that contains the business logic for the domain below.
Domain: a medical triage prioritisation (symptoms, vitals, risk factors).
Scope: a rule-heavy domain with many interacting business rules, edge cases and special conditions. Implement every rule and edge case fully and explicitly, even where this leads to deeply nested conditionals, multiple loops and switch statements.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 25. `repository_low_1.ts`  —  tier: low (max CC <= 5)

```text
Generate a NestJS data-access Repository class that performs CRUD-style operations for the domain below against an in-memory data store, applying any selection/validation rules in code.
Domain: a podcast subscription list.
Scope: a simple domain with very few rules. Implement the operations with mostly straight-line logic and minimal conditional branching.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 26. `repository_low_2.ts`  —  tier: low (max CC <= 5)

```text
Generate a NestJS data-access Repository class that performs CRUD-style operations for the domain below against an in-memory data store, applying any selection/validation rules in code.
Domain: a product wishlist.
Scope: a simple domain with very few rules. Implement the operations with mostly straight-line logic and minimal conditional branching.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 27. `repository_low_3.ts`  —  tier: low (max CC <= 5)

```text
Generate a NestJS data-access Repository class that performs CRUD-style operations for the domain below against an in-memory data store, applying any selection/validation rules in code.
Domain: a plant-watering reminder list.
Scope: a simple domain with very few rules. Implement the operations with mostly straight-line logic and minimal conditional branching.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 28. `repository_low_4.ts`  —  tier: low (max CC <= 5)

```text
Generate a NestJS data-access Repository class that performs CRUD-style operations for the domain below against an in-memory data store, applying any selection/validation rules in code.
Domain: a gift-idea list.
Scope: a simple domain with very few rules. Implement the operations with mostly straight-line logic and minimal conditional branching.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 29. `repository_medium_1.ts`  —  tier: medium (5 < max CC <= 10)

```text
Generate a NestJS data-access Repository class that performs CRUD-style operations for the domain below against an in-memory data store, applying any selection/validation rules in code.
Domain: a gym class booking with capacity and waitlist handling.
Scope: a domain with a moderate set of business rules — four to seven independent validity or state checks in its busiest operation, and fewer in the others. Implement each check as a direct conditional; the checks stand alone rather than combining into nested special cases.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 30. `repository_medium_2.ts`  —  tier: medium (5 < max CC <= 10)

```text
Generate a NestJS data-access Repository class that performs CRUD-style operations for the domain below against an in-memory data store, applying any selection/validation rules in code.
Domain: a flight seat selection with fare classes.
Scope: a domain with a moderate set of business rules — four to seven independent validity or state checks in its busiest operation, and fewer in the others. Implement each check as a direct conditional; the checks stand alone rather than combining into nested special cases.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 31. `repository_medium_3.ts`  —  tier: medium (5 < max CC <= 10)

```text
Generate a NestJS data-access Repository class that performs CRUD-style operations for the domain below against an in-memory data store, applying any selection/validation rules in code.
Domain: a support ticket queue with priority routing.
Scope: a domain with a moderate set of business rules — four to seven independent validity or state checks in its busiest operation, and fewer in the others. Implement each check as a direct conditional; the checks stand alone rather than combining into nested special cases.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 32. `repository_medium_4.ts`  —  tier: medium (5 < max CC <= 10)

```text
Generate a NestJS data-access Repository class that performs CRUD-style operations for the domain below against an in-memory data store, applying any selection/validation rules in code.
Domain: a loyalty-points accrual and redemption flow.
Scope: a domain with a moderate set of business rules — four to seven independent validity or state checks in its busiest operation, and fewer in the others. Implement each check as a direct conditional; the checks stand alone rather than combining into nested special cases.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 33. `repository_high_1.ts`  —  tier: high (max CC > 10)

```text
Generate a NestJS data-access Repository class that performs CRUD-style operations for the domain below against an in-memory data store, applying any selection/validation rules in code.
Domain: a telecom billing rating (call types, tiers, roaming, taxes).
Scope: a rule-heavy domain with many interacting business rules, edge cases and special conditions. Implement every rule and edge case fully and explicitly, even where this leads to deeply nested conditionals, multiple loops and switch statements.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 34. `repository_high_2.ts`  —  tier: high (max CC > 10)

```text
Generate a NestJS data-access Repository class that performs CRUD-style operations for the domain below against an in-memory data store, applying any selection/validation rules in code.
Domain: a mortgage eligibility engine (DTI, LTV, employment, property type).
Scope: a rule-heavy domain with many interacting business rules, edge cases and special conditions. Implement every rule and edge case fully and explicitly, even where this leads to deeply nested conditionals, multiple loops and switch statements.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 35. `repository_high_3.ts`  —  tier: high (max CC > 10)

```text
Generate a NestJS data-access Repository class that performs CRUD-style operations for the domain below against an in-memory data store, applying any selection/validation rules in code.
Domain: a logistics dispatch optimiser (capacity, time windows, priorities).
Scope: a rule-heavy domain with many interacting business rules, edge cases and special conditions. Implement every rule and edge case fully and explicitly, even where this leads to deeply nested conditionals, multiple loops and switch statements.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 36. `repository_high_4.ts`  —  tier: high (max CC > 10)

```text
Generate a NestJS data-access Repository class that performs CRUD-style operations for the domain below against an in-memory data store, applying any selection/validation rules in code.
Domain: a dynamic pricing engine (demand, inventory, competitor price, customer segment).
Scope: a rule-heavy domain with many interacting business rules, edge cases and special conditions. Implement every rule and edge case fully and explicitly, even where this leads to deeply nested conditionals, multiple loops and switch statements.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 37. `middleware_low_1.ts`  —  tier: low (max CC <= 5)

```text
Generate a NestJS middleware (implements NestMiddleware) that inspects and processes incoming requests for the domain below.
Domain: a favourite-quotes collection.
Scope: a simple domain with very few rules. Implement the operations with mostly straight-line logic and minimal conditional branching.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 38. `middleware_low_2.ts`  —  tier: low (max CC <= 5)

```text
Generate a NestJS middleware (implements NestMiddleware) that inspects and processes incoming requests for the domain below.
Domain: a simple note tagging store.
Scope: a simple domain with very few rules. Implement the operations with mostly straight-line logic and minimal conditional branching.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 39. `middleware_low_3.ts`  —  tier: low (max CC <= 5)

```text
Generate a NestJS middleware (implements NestMiddleware) that inspects and processes incoming requests for the domain below.
Domain: a book-lending tracker.
Scope: a simple domain with very few rules. Implement the operations with mostly straight-line logic and minimal conditional branching.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 40. `middleware_low_4.ts`  —  tier: low (max CC <= 5)

```text
Generate a NestJS middleware (implements NestMiddleware) that inspects and processes incoming requests for the domain below.
Domain: a link-shortener registry.
Scope: a simple domain with very few rules. Implement the operations with mostly straight-line logic and minimal conditional branching.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 41. `middleware_medium_1.ts`  —  tier: medium (5 < max CC <= 10)

```text
Generate a NestJS middleware (implements NestMiddleware) that inspects and processes incoming requests for the domain below.
Domain: a ride fare estimation with surge time windows.
Scope: a domain with a moderate set of business rules — four to seven independent validity or state checks in its busiest operation, and fewer in the others. Implement each check as a direct conditional; the checks stand alone rather than combining into nested special cases.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 42. `middleware_medium_2.ts`  —  tier: medium (5 < max CC <= 10)

```text
Generate a NestJS middleware (implements NestMiddleware) that inspects and processes incoming requests for the domain below.
Domain: an inventory restock with reorder thresholds.
Scope: a domain with a moderate set of business rules — four to seven independent validity or state checks in its busiest operation, and fewer in the others. Implement each check as a direct conditional; the checks stand alone rather than combining into nested special cases.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 43. `middleware_medium_3.ts`  —  tier: medium (5 < max CC <= 10)

```text
Generate a NestJS middleware (implements NestMiddleware) that inspects and processes incoming requests for the domain below.
Domain: an appointment scheduler with working-hour constraints.
Scope: a domain with a moderate set of business rules — four to seven independent validity or state checks in its busiest operation, and fewer in the others. Implement each check as a direct conditional; the checks stand alone rather than combining into nested special cases.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 44. `middleware_medium_4.ts`  —  tier: medium (5 < max CC <= 10)

```text
Generate a NestJS middleware (implements NestMiddleware) that inspects and processes incoming requests for the domain below.
Domain: a currency exchange with tiered spreads.
Scope: a domain with a moderate set of business rules — four to seven independent validity or state checks in its busiest operation, and fewer in the others. Implement each check as a direct conditional; the checks stand alone rather than combining into nested special cases.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 45. `middleware_high_1.ts`  —  tier: high (max CC > 10)

```text
Generate a NestJS middleware (implements NestMiddleware) that inspects and processes incoming requests for the domain below.
Domain: a KYC/AML compliance check (document types, risk countries, watchlists).
Scope: a rule-heavy domain with many interacting business rules, edge cases and special conditions. Implement every rule and edge case fully and explicitly, even where this leads to deeply nested conditionals, multiple loops and switch statements.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 46. `middleware_high_2.ts`  —  tier: high (max CC > 10)

```text
Generate a NestJS middleware (implements NestMiddleware) that inspects and processes incoming requests for the domain below.
Domain: a student grading and progression engine (weighted components, resits, caps).
Scope: a rule-heavy domain with many interacting business rules, edge cases and special conditions. Implement every rule and edge case fully and explicitly, even where this leads to deeply nested conditionals, multiple loops and switch statements.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 47. `middleware_high_3.ts`  —  tier: high (max CC > 10)

```text
Generate a NestJS middleware (implements NestMiddleware) that inspects and processes incoming requests for the domain below.
Domain: a supply-chain reorder planner (lead times, safety stock, seasonality).
Scope: a rule-heavy domain with many interacting business rules, edge cases and special conditions. Implement every rule and edge case fully and explicitly, even where this leads to deeply nested conditionals, multiple loops and switch statements.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 48. `middleware_high_4.ts`  —  tier: high (max CC > 10)

```text
Generate a NestJS middleware (implements NestMiddleware) that inspects and processes incoming requests for the domain below.
Domain: an access-control policy evaluator (roles, resources, conditions, hierarchy).
Scope: a rule-heavy domain with many interacting business rules, edge cases and special conditions. Implement every rule and edge case fully and explicitly, even where this leads to deeply nested conditionals, multiple loops and switch statements.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 49. `dto_low_1.ts`  —  tier: low (max CC <= 5)

```text
Generate a set of TypeScript DTO / validator classes (using class-validator decorators) plus any helper validation logic for the domain below.
Domain: an FAQ entry store.
Scope: a simple domain with very few rules. Implement the operations with mostly straight-line logic and minimal conditional branching.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 50. `dto_low_2.ts`  —  tier: low (max CC <= 5)

```text
Generate a set of TypeScript DTO / validator classes (using class-validator decorators) plus any helper validation logic for the domain below.
Domain: a unit-of-measure catalogue.
Scope: a simple domain with very few rules. Implement the operations with mostly straight-line logic and minimal conditional branching.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 51. `dto_low_3.ts`  —  tier: low (max CC <= 5)

```text
Generate a set of TypeScript DTO / validator classes (using class-validator decorators) plus any helper validation logic for the domain below.
Domain: a saved-search registry.
Scope: a simple domain with very few rules. Implement the operations with mostly straight-line logic and minimal conditional branching.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 52. `dto_low_4.ts`  —  tier: low (max CC <= 5)

```text
Generate a set of TypeScript DTO / validator classes (using class-validator decorators) plus any helper validation logic for the domain below.
Domain: a sticker/emoji pack catalogue.
Scope: a simple domain with very few rules. Implement the operations with mostly straight-line logic and minimal conditional branching.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 53. `dto_medium_1.ts`  —  tier: medium (5 < max CC <= 10)

```text
Generate a set of TypeScript DTO / validator classes (using class-validator decorators) plus any helper validation logic for the domain below.
Domain: a course enrollment with prerequisite checks.
Scope: a domain with a moderate set of business rules — four to seven independent validity or state checks in its busiest operation, and fewer in the others. Implement each check as a direct conditional; the checks stand alone rather than combining into nested special cases.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 54. `dto_medium_2.ts`  —  tier: medium (5 < max CC <= 10)

```text
Generate a set of TypeScript DTO / validator classes (using class-validator decorators) plus any helper validation logic for the domain below.
Domain: a promo-code engine with simple stacking rules.
Scope: a domain with a moderate set of business rules — four to seven independent validity or state checks in its busiest operation, and fewer in the others. Implement each check as a direct conditional; the checks stand alone rather than combining into nested special cases.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 55. `dto_medium_3.ts`  —  tier: medium (5 < max CC <= 10)

```text
Generate a set of TypeScript DTO / validator classes (using class-validator decorators) plus any helper validation logic for the domain below.
Domain: a warehouse pick-list with order batching.
Scope: a domain with a moderate set of business rules — four to seven independent validity or state checks in its busiest operation, and fewer in the others. Implement each check as a direct conditional; the checks stand alone rather than combining into nested special cases.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 56. `dto_medium_4.ts`  —  tier: medium (5 < max CC <= 10)

```text
Generate a set of TypeScript DTO / validator classes (using class-validator decorators) plus any helper validation logic for the domain below.
Domain: a meeting-room booking with conflict resolution.
Scope: a domain with a moderate set of business rules — four to seven independent validity or state checks in its busiest operation, and fewer in the others. Implement each check as a direct conditional; the checks stand alone rather than combining into nested special cases.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 57. `dto_high_1.ts`  —  tier: high (max CC > 10)

```text
Generate a set of TypeScript DTO / validator classes (using class-validator decorators) plus any helper validation logic for the domain below.
Domain: a promotion eligibility engine (segments, purchase history, stacking, exclusions).
Scope: a rule-heavy domain with many interacting business rules, edge cases and special conditions. Implement every rule and edge case fully and explicitly, even where this leads to deeply nested conditionals, multiple loops and switch statements.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 58. `dto_high_2.ts`  —  tier: high (max CC > 10)

```text
Generate a set of TypeScript DTO / validator classes (using class-validator decorators) plus any helper validation logic for the domain below.
Domain: an energy tariff calculator (time-of-use, tiers, surcharges, rebates).
Scope: a rule-heavy domain with many interacting business rules, edge cases and special conditions. Implement every rule and edge case fully and explicitly, even where this leads to deeply nested conditionals, multiple loops and switch statements.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 59. `dto_high_3.ts`  —  tier: high (max CC > 10)

```text
Generate a set of TypeScript DTO / validator classes (using class-validator decorators) plus any helper validation logic for the domain below.
Domain: a cancellation-penalty engine (timing, customer tier, reason, partial refunds).
Scope: a rule-heavy domain with many interacting business rules, edge cases and special conditions. Implement every rule and edge case fully and explicitly, even where this leads to deeply nested conditionals, multiple loops and switch statements.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```

### 60. `dto_high_4.ts`  —  tier: high (max CC > 10)

```text
Generate a set of TypeScript DTO / validator classes (using class-validator decorators) plus any helper validation logic for the domain below.
Domain: a multi-currency invoice reconciliation (FX, rounding, tax, disputes).
Scope: a rule-heavy domain with many interacting business rules, edge cases and special conditions. Implement every rule and edge case fully and explicitly, even where this leads to deeply nested conditionals, multiple loops and switch statements.
Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.
Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.
```
