export interface OwnedContribution {
  id: string;
  owner: string;
}

export interface RegisteredContribution<TContribution extends OwnedContribution> {
  contribution: TContribution;
  registeredAt: number;
}

export class DuplicateContributionError extends Error {
  constructor(id: string, existingOwner: string, newOwner: string) {
    super(`Duplicate contribution id "${id}" from "${newOwner}". Already registered by "${existingOwner}".`);
    this.name = 'DuplicateContributionError';
  }
}

export class RegistryFrozenError extends Error {
  constructor(registryName: string) {
    super(`${registryName} is frozen and cannot accept new contributions.`);
    this.name = 'RegistryFrozenError';
  }
}

export class ContributionRegistry<TContribution extends OwnedContribution> {
  private readonly contributions = new Map<string, RegisteredContribution<TContribution>>();
  private frozen = false;

  constructor(private readonly registryName: string) {}

  register(contribution: TContribution): void {
    if (this.frozen) throw new RegistryFrozenError(this.registryName);

    const existing = this.contributions.get(contribution.id);
    if (existing) {
      throw new DuplicateContributionError(
        contribution.id,
        existing.contribution.owner,
        contribution.owner
      );
    }

    this.contributions.set(contribution.id, {
      contribution,
      registeredAt: Date.now(),
    });
  }

  get(id: string): TContribution | undefined {
    return this.contributions.get(id)?.contribution;
  }

  has(id: string): boolean {
    return this.contributions.has(id);
  }

  list(): readonly TContribution[] {
    return Array.from(this.contributions.values(), (entry) => entry.contribution);
  }

  freeze(): void {
    this.frozen = true;
  }

  isFrozen(): boolean {
    return this.frozen;
  }
}
