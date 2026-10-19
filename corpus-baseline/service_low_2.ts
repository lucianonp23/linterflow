import { Injectable } from '@nestjs/common';

export interface Ingredient {
  id: string;
  name: string;
  amount: number;
  unit: string;
}

@Injectable()
export class RecipeIngredientService {
  private readonly storage = new Map<string, Ingredient[]>();

  public getIngredients(recipeId: string): Ingredient[] {
    const ingredients = this.storage.get(recipeId);
    return ingredients ? [...ingredients] : [];
  }

  public addIngredient(
    recipeId: string,
    name: string,
    amount: number,
    unit: string,
  ): Ingredient {
    const ingredient: Ingredient = {
      id: this.generateUniqueId(),
      name,
      amount,
      unit,
    };

    const currentIngredients = this.getIngredients(recipeId);
    this.storage.set(recipeId, [...currentIngredients, ingredient]);

    return ingredient;
  }

  public removeIngredient(recipeId: string, ingredientId: string): void {
    const currentIngredients = this.getIngredients(recipeId);
    const updatedIngredients = currentIngredients.filter(
      (ingredient) => ingredient.id !== ingredientId,
    );

    this.storage.set(recipeId, updatedIngredients);
  }

  public clearIngredients(recipeId: string): void {
    this.storage.delete(recipeId);
  }

  public scaleIngredients(recipeId: string, factor: number): Ingredient[] {
    const currentIngredients = this.getIngredients(recipeId);
    const scaledIngredients = currentIngredients.map((ingredient) => ({
      ...ingredient,
      amount: ingredient.amount * factor,
    }));

    this.storage.set(recipeId, scaledIngredients);
    return scaledIngredients;
  }

  private generateUniqueId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
  }
}