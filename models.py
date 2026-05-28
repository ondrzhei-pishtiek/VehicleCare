from sqlalchemy import Column, Integer, String, ForeignKey, Boolean, Float, Text
from sqlalchemy.orm import relationship
from database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    password = Column(String)

    cars = relationship("Car", back_populates="owner")

class Car(Base):
    __tablename__ = "cars"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    make = Column(String)
    model = Column(String)
    engine = Column(String)
    year = Column(Integer)
    color = Column(String)
    license_plate = Column(String)
    vin = Column(String, default="")
    current_mileage = Column(Integer, default=0)
    last_service_mileage = Column(Integer, default=0)

    owner = relationship("User", back_populates="cars")
    issues = relationship("Issue", back_populates="car")
    expenses = relationship("Expense", back_populates="car")

class Issue(Base):
    __tablename__ = "issues"
    id = Column(Integer, primary_key=True, index=True)
    car_id = Column(Integer, ForeignKey("cars.id"))
    category = Column(String)
    description = Column(String)
    issue_type = Column(String, default="Симптом")
    priority = Column(String, default="Може почекати")
    is_resolved = Column(Boolean, default=False)
    mileage_at_issue = Column(Integer, default=0)
    receipt_image = Column(Text, default="")

    car = relationship("Car", back_populates="issues")

class Expense(Base):
    __tablename__ = "expenses"
    id = Column(Integer, primary_key=True, index=True)
    car_id = Column(Integer, ForeignKey("cars.id"))
    amount = Column(Float)
    description = Column(String)
    date = Column(String)

    car = relationship("Car", back_populates="expenses")
