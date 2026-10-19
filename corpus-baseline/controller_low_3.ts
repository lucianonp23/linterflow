import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  address: string;
}

export class CreateContactDto {
  firstName!: string;
  lastName!: string;
  email!: string;
  phoneNumber!: string;
  address!: string;
}

export class UpdateContactDto {
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
  address?: string;
}

@Controller('contacts')
export class AddressBookController {
  private contacts: Contact[] = [];

  @Get()
  getAllContacts(): Contact[] {
    return [...this.contacts];
  }

  @Get(':id')
  getContactById(@Param('id') id: string): Contact {
    const index = this.findContactIndexOrThrow(id);
    return this.contacts[index];
  }

  @Post()
  createContact(@Body() dto: CreateContactDto): Contact {
    const newContact: Contact = {
      id: Date.now().toString(),
      ...dto,
    };
    this.contacts.push(newContact);
    return newContact;
  }

  @Put(':id')
  updateContact(
    @Param('id') id: string,
    @Body() dto: UpdateContactDto,
  ): Contact {
    const index = this.findContactIndexOrThrow(id);
    const updatedContact: Contact = {
      ...this.contacts[index],
      ...dto,
    };
    this.contacts[index] = updatedContact;
    return updatedContact;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteContact(@Param('id') id: string): void {
    const index = this.findContactIndexOrThrow(id);
    this.contacts.splice(index, 1);
  }

  private findContactIndexOrThrow(id: string): number {
    const index = this.contacts.findIndex((contact) => contact.id === id);
    if (index === -1) {
      throw new NotFoundException(`Contact with ID ${id} not found`);
    }
    return index;
  }
}