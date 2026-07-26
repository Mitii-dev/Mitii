# Routing Patterns in SaaS API Benchmark Fixture

## Overview
This document describes the routing patterns and configuration approaches used in this synthetic SaaS API benchmark fixture. The system is designed for retrieval evaluation purposes and follows standard NestJS modular architecture patterns.

## Module-Based Routing Structure

### Base Routes
Each module is mounted at a specific base route corresponding to its domain:
- `/auth` - Authentication module
- `/users` - User management module  
- `/products` - Product catalog module
- `/orders` - Order processing module
- `/payments` - Payment processing module
- `/inventory` - Inventory management module
- `/cart` - Shopping cart functionality
- And so on for all 17 domain modules

### Standard REST Endpoints
All controllers follow standard REST conventions:
- `GET /:id` - Retrieve specific resource
- `GET /` - Retrieve list of resources  
- `POST /` - Create new resource
- `PUT /:id` - Update existing resource
- `DELETE /:id` - Delete resource

### Route Handler Patterns
Controllers implement consistent handler patterns:
```typescript
// Standard CRUD operations
async create(req: { body: CreateDto }) {
  return this.service.create(req.body);
}

async findOne(req: { params: { id: string } }) {
  return this.service.findById(req.params.id);
}

async findAll() {
  return this.service.list();
}
```

### Module-Specific Operations
Each module includes specialized route handlers for domain-specific functionality:
- Authentication: `hashPasswordRoute`, `generateAccessTokenRoute`
- Users: `deactivateUserRoute`, `mergeDuplicateAccountsRoute`  
- Orders: `cancelOrderRoute`, `convertCartToOrderRoute`
- Products: `adjustPriceRoute`, `discontinueProductRoute`
- Cart: `mergeGuestCartRoute`, `checkoutCartRoute`
- Inventory: `reserveStockRoute`, `releaseStockRoute`

## Configuration Approach

### Modular Architecture
The application uses a modular approach where:
1. Each domain has its own module file (e.g., `auth.module.ts`)
2. Modules contain controller, service, and repository classes
3. The root `AppModule` composes all domain modules together

### Service Layer Integration
Controllers delegate to services which handle business logic:
- Controllers receive HTTP requests and parse parameters/bodies
- Services perform the actual work using repositories
- Repositories handle data access operations

## Build Process

### Compilation
The build process consists of standard TypeScript compilation:
```json
"build": "tsc -p tsconfig.json"
```

### No Documentation Tools
This benchmark fixture intentionally excludes documentation infrastructure:
- No Docusaurus configuration files
- No sidebar definitions
- No documentation-specific build processes
- Pure API-focused implementation

## Key Design Principles

1. **Consistency**: All modules follow the same patterns and conventions
2. **Separation of Concerns**: Clear distinction between controllers, services, and repositories  
3. **RESTful APIs**: Standard HTTP methods and resource-based URLs
4. **Modularity**: Independent domain modules that can be composed together
5. **Benchmark-Focused**: Designed for retrieval evaluation rather than production documentation

## Implementation Details

### Controller Structure
Each controller class:
- Takes service instance in constructor
- Exposes HTTP entry points via methods
- Uses consistent parameter parsing patterns
- Returns service results directly

### Module Wiring
Modules are wired together in the root `AppModule`:
```typescript
export class AppModule {
  readonly auth = new AuthModule();
  readonly users = new UsersModule();
  // ... other modules
}
```

This structure allows for easy composition and testing of individual components while maintaining a cohesive API surface.