import { Injectable } from '@nestjs/common';

export interface Ingredient {
  id: string;
  name: string;
  amount: number;
  unit: string;
}

@Injectable()
export class RecipeIngredientService {
  private readonly storage: Map<string, Ingredient[]> = new Map();

  public getIngredients(recipeId: string): Ingredient[] {
    return this.storage.get(recipeId) ?? [];
  }

  public addIngredient(
    recipeId: string,
    name: string,
    amount: number,
    unit: string,
  ): Ingredient {
    const ingredients = this.getIngredients(recipeId);
    const ingredient: Ingredient = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
      name,
      amount,
      unit,
    };
    this.storage.set(recipeId, [...ingredients, ingredient]);
    return ingredient;
  }

  public removeIngredient(recipeId: string, ingredientId: string): void {
    const ingredients = this.getIngredients(recipeId);
    const updatedIngredients = ingredients.filter(
      (item) => item.id !== ingredientId,
    );
    this.storage.set(recipeId, updatedIngredients);
  }

  public clearIngredients(recipeId: string): void {
    this.storage.delete(recipeId);
  }

  public scaleIngredients(recipeId: string, factor: number): Ingredient[] {
    const ingredients = this.getIngredients(recipeId);
    const scaled = ingredients.map((item) => ({
      ...item,
      amount: item.amount * factor,
    }));
    this.storage.set(recipeId, scaled);
    return scaled;
  }
}
