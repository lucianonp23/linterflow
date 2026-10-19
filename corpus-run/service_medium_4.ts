import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';

export enum LoanStatus {
  ACTIVE = 'ACTIVE',
  RETURNED = 'RETURNED',
  LOST = 'LOST',
}

export interface BookCopy {
  id: string;
  bookId: string;
  isReserved: boolean;
}

export interface Member {
  id: string;
  isActive: boolean;
  unpaidFines: number;
}

export interface Loan {
  id: string;
  memberId: string;
  bookCopyId: string;
  status: LoanStatus;
  dueDate: Date;
  renewalCount: number;
  returnedDate?: Date;
  fineAmount: number;
}

@Injectable()
export class LibraryLoanService {
  private readonly maxRenewals = 3;
  private readonly finePerDay = 2.0;
  private readonly maxUnpaidFinesAllowed = 15.0;

  private loans: Map<string, Loan> = new Map();
  private members: Map<string, Member> = new Map();
  private bookCopies: Map<string, BookCopy> = new Map();

  public renewLoan(loanId: string, memberId: string, currentDate: Date = new Date()): Loan {
    const loan = this.loans.get(loanId);
    if (!loan) {
      throw new NotFoundException('Loan record not found.');
    }

    if (loan.memberId !== memberId) {
      throw new ForbiddenException('Loan does not belong to the specified member.');
    }

    if (loan.status !== LoanStatus.ACTIVE) {
      throw new BadRequestException('Cannot renew a loan that is not active.');
    }

    if (currentDate > loan.dueDate) {
      throw new BadRequestException('Cannot renew an overdue loan.');
    }

    if (loan.renewalCount >= this.maxRenewals) {
      throw new BadRequestException('Maximum renewal limit reached for this loan.');
    }

    const copy = this.bookCopies.get(loan.bookCopyId);
    if (copy && copy.isReserved) {
      throw new BadRequestException('Cannot renew book because another patron has placed a hold on it.');
    }

    const member = this.members.get(memberId);
    if (member && member.unpaidFines > this.maxUnpaidFinesAllowed) {
      throw new BadRequestException('Member has unpaid fines exceeding the allowed threshold.');
    }

    loan.renewalCount += 1;
    const newDueDate = new Date(currentDate.getTime());
    newDueDate.setDate(newDueDate.getDate() + 14);
    loan.dueDate = newDueDate;

    this.loans.set(loan.id, loan);
    return loan;
  }

  public calculateFine(loanId: string, currentDate: Date = new Date()): number {
    const loan = this.loans.get(loanId);
    if (!loan) {
      throw new NotFoundException('Loan record not found.');
    }

    if (loan.status !== LoanStatus.ACTIVE) {
      return loan.fineAmount;
    }

    if (currentDate <= loan.dueDate) {
      return 0;
    }

    const diffTime = Math.abs(currentDate.getTime() - loan.dueDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays * this.finePerDay;
  }

  public returnBook(loanId: string, currentDate: Date = new Date()): Loan {
    const loan = this.loans.get(loanId);
    if (!loan) {
      throw new NotFoundException('Loan record not found.');
    }

    if (loan.status !== LoanStatus.ACTIVE) {
      throw new BadRequestException('Loan is not currently active.');
    }

    const fine = this.calculateFine(loanId, currentDate);
    loan.fineAmount = fine;
    loan.status = LoanStatus.RETURNED;
    loan.returnedDate = currentDate;

    if (fine > 0) {
      const member = this.members.get(loan.memberId);
      if (member) {
        member.unpaidFines += fine;
      }
    }

    this.loans.set(loan.id, loan);
    return loan;
  }

  public payFine(memberId: string, amount: number): Member {
    const member = this.members.get(memberId);
    if (!member) {
      throw new NotFoundException('Member not found.');
    }

    if (amount <= 0) {
      throw new BadRequestException('Payment amount must be greater than zero.');
    }

    member.unpaidFines = Math.max(0, member.unpaidFines - amount);
    this.members.set(member.id, member);
    return member;
  }
}
